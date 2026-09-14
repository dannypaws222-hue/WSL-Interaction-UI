# Allay Phase 1: Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Allay server + client with a live-updating monitoring
dashboard (hook, mail, rigs, bead queue) backed by real `gt`/`bd` CLI calls,
with the baseline security model (loopback-only, token-authenticated,
`execFile`-based CLI access) in place from the start.

**Architecture:** Node.js/TypeScript server (Express + `ws`) shells out to
`gt`/`bd` via a hardened CLI adapter, polls each resource on its own
scheduler with caching/backoff, and exposes snapshots over a token-gated
REST API and WebSocket. A React (Vite) client connects over WebSocket
(behind a same-origin dev proxy) and renders those snapshots as a
dashboard, with reconnect-with-backoff on disconnect.

**Tech Stack:** TypeScript, Node.js, Express, `ws`, React, Vite, Vitest,
`@testing-library/react`, `supertest`.

**Spec:** `docs/superpowers/specs/2026-09-13-allay-desktop-ui-design.md`

**Scope note:** This plan implements spec rollout steps 1–2 only: the
Mayor-ACP spike, and the `cli-adapter` + `poll-scheduler` + MonitorView
slice. The ACP bridge/ChatView and nudge-bridge/ActivityView (rollout
steps 3–4) are separate follow-up plans — the spike in Task 1 may change
the ACP bridge design, so building chat ahead of it would be waste.
Baseline security (loopback bind, auth token, Host/Origin checks,
`execFile` with fixed argv) is **not** deferred to a later "hardening
pass" — it's built in this plan, per the spec's Security section, because
this dashboard is real network-facing surface from day one.

**Revision note:** This plan was reviewed (via an independent Codex
review pass) before implementation started. That review caught real bugs
in the first draft — a `Poller.stop()` race, a missing import, an
ESM-extension issue that would have broken the TypeScript build, a
CORS/proxy gap, and several security gaps (Host check, timing-safe token
compare, token-file creation race, WS path matching). All are fixed
below; the fixes are folded directly into the affected tasks rather than
listed separately, so the plan below is already corrected.

## Global Constraints

- Server binds to `127.0.0.1` only — never `0.0.0.0`. Test servers in
  this plan also bind explicitly to `127.0.0.1`, not the default
  all-interfaces bind.
- Server source uses `"module": "NodeNext"` — every relative import uses
  an explicit `.js` extension (`from './exec.js'`), even though the
  source file is `.ts`. This is required by NodeNext ESM resolution;
  omitting it breaks `tsc` builds even though some dev runners tolerate
  it.
- Every REST call under `/api/*` and the WS upgrade require: (a) a `Host`
  header matching `127.0.0.1` or `localhost` (with optional port), and
  (b) the local auth token (`x-allay-token` header for REST, `?token=`
  query param for WS). `/healthz` is the one exception to the token
  requirement (it returns no state), but it still gets the Host check.
- The WS upgrade additionally rejects any request whose `Origin` header
  is present but not `http(s)://(127.0.0.1|localhost)[:port]` — a
  missing Origin (non-browser clients) is allowed through on Host+token
  auth alone. The WS path must match `/ws` exactly (not merely start
  with it).
- Token comparison uses a timing-safe, equal-length-checked comparison
  (`node:crypto`'s `timingSafeEqual`), never `===` on raw strings. Token
  file creation is exclusive (`flag: 'wx'`) with a race-safe fallback to
  re-read, and an empty existing token file is treated as "no token yet".
- All CLI invocation goes through the `cli-adapter`, using `execFile`
  with a fixed command and a validated argv array — never shell string
  interpolation.
- Every CLI call has a timeout and a capped output size.
- Read polls retry with backoff; nothing in this plan auto-retries a
  mutating call (none exist yet in this phase).
- Contract tests must run against the real `gt`/`bd` CLI (not mocks
  alone) to catch schema drift, gated behind `ALLAY_LIVE_TESTS=1` so
  default `npm test` stays hermetic.
- The Vite dev client talks to the server through a same-origin dev
  proxy (`/api`, `/ws`) — never cross-origin `fetch`/`WebSocket` calls
  from the client's own origin to the server's port, which would need
  CORS and would trigger preflight on the custom token header.

---

### Task 1: Spike — Mayor ACP Session Ownership Investigation

**Files:**
- Create: `scripts/spike-mayor-acp.mjs` (throwaway; deleted or relocated at
  the end of this task)
- Modify: `docs/superpowers/specs/2026-09-13-allay-desktop-ui-design.md`
  (append "Spike Results" section)

**Interfaces:**
- Consumes: nothing (standalone Node script, no project deps required)
- Produces: a documented answer to "does `gt mayor acp` create an
  independent Mayor identity, and is it safe to run alongside the live
  tmux Mayor?" — this determines whether the future ACP-bridge plan needs
  a mutual-exclusion lock. No code interface is produced for later tasks.
  **An explicit "Inconclusive" finding is an acceptable outcome** — it
  blocks only the future ACP-bridge follow-up plan, not this one (this
  plan never launches `gt mayor acp`).

- [ ] **Step 1: Capture baseline agent/hook/mail state**

Run from the town root:

```bash
gt agents list --json > /tmp/allay-spike-before.json
gt hook --json > /tmp/allay-spike-hook-before.json
gt mail inbox --json > /tmp/allay-spike-mail-before.json
gt mayor status > /tmp/allay-spike-mayor-status-before.txt 2>&1
```

- [ ] **Step 2: Write the spike script**

This goes beyond a bare `initialize` call — it attempts to open a session
and send one real prompt, since identity/interference can only show up
once a session actually does something.

```js
// scripts/spike-mayor-acp.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn('gt', ['mayor', 'acp'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  const message = { jsonrpc: '2.0', id, method, params };
  console.log(`[spike] -> ${method}`, JSON.stringify(params));
  child.stdin.write(JSON.stringify(message) + '\n');
  return id;
}

rl.on('line', (line) => {
  console.log(`[spike] <- ${line}`);
});

child.on('exit', (code, signal) => {
  console.log(`[spike] mayor acp exited code=${code} signal=${signal}`);
});

// Sequence: initialize -> attempt to open a session -> send one trivial
// prompt. Exact method names are the unknown being spiked — if a method
// errors, the error response itself is a valid, recorded result.
send('initialize', { protocolVersion: 1, clientCapabilities: {} });
setTimeout(() => send('session/new', {}), 1000);
setTimeout(() => send('session/prompt', { prompt: 'Reply with the single word: pong' }), 2500);

setTimeout(() => {
  console.log('[spike] window elapsed — killing child, inspect transcript above.');
  child.kill();
}, 8000);
```

- [ ] **Step 3: Run it and capture output**

```bash
node scripts/spike-mayor-acp.mjs > /tmp/allay-spike-acp-output.log 2>&1
cat /tmp/allay-spike-acp-output.log
```

If any request produces no response, or an error response naming a
different method, that's still a valid result — record the exact
error/behavior rather than assuming the guessed method names are right.

- [ ] **Step 4: Capture post-spike state and check for interference**

```bash
gt agents list --json > /tmp/allay-spike-after.json
gt hook --json > /tmp/allay-spike-hook-after.json
gt mail inbox --json > /tmp/allay-spike-mail-after.json
gt mayor status > /tmp/allay-spike-mayor-status-after.txt 2>&1
diff /tmp/allay-spike-before.json /tmp/allay-spike-after.json
diff /tmp/allay-spike-hook-before.json /tmp/allay-spike-hook-after.json
diff /tmp/allay-spike-mail-before.json /tmp/allay-spike-mail-after.json
diff /tmp/allay-spike-mayor-status-before.txt /tmp/allay-spike-mayor-status-after.txt
```

Confirm the live tmux Mayor's hook/mail/status is unchanged (aside from
anything this investigation itself intentionally sent, e.g. the "pong"
prompt if it was in fact routed to the live Mayor rather than an
independent instance — that routing behavior is exactly what's being
determined).

- [ ] **Step 5: Document findings in the spec**

Append to `docs/superpowers/specs/2026-09-13-allay-desktop-ui-design.md`:

```markdown
## Spike Results (Task 1)

- Identity: <does `gt mayor acp` register as a new/separate agent, reuse
  the existing hq-mayor identity, or is this Inconclusive from the
  evidence gathered? cite the `gt agents list` diff>
- Protocol framing/methods observed: <newline-delimited JSON-RPC
  confirmed? which method names got real responses vs errors>
- Interference with live tmux Mayor: <none observed / describe exactly
  what changed, including whether the "pong" prompt reached it>
- Recommendation: <safe to run concurrently with the live Mayor, must be
  mutually exclusive (and how to enforce that), or Inconclusive pending
  further investigation — this gates the ACP-bridge follow-up plan only>
```

- [ ] **Step 6: Clean up the throwaway script**

```bash
git rm --cached scripts/spike-mayor-acp.mjs 2>/dev/null || true
rm -f scripts/spike-mayor-acp.mjs
```

Only keep it (move to `server/scripts/`) if the findings show it's useful
as an ongoing dev utility; if so, say why in the commit message.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-13-allay-desktop-ui-design.md
git commit -m "docs: record Mayor ACP session-ownership spike results"
```

---

### Task 2: Repo & Server Scaffolding

**Files:**
- Create: `package.json` (root, npm workspaces: `server`, `client`)
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/app.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createApp(): express.Express` — an Express app with a
  `/healthz` route. Task 8 extends this signature to
  `createApp(pollers: PollerMap, getToken: () => string)`.

- [ ] **Step 1: Root workspace config**

```json
// package.json
{
  "name": "allay",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Server package config**

```json
// server/package.json
{
  "name": "@allay/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.12",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`supertest@7` ships its own types; no separate `@types/supertest` needed.

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```ts
// server/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 3: Write the failing test**

```ts
// server/src/app.test.ts
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
  it('responds to /healthz', async () => {
    const app = createApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './app.js'`

- [ ] **Step 5: Implement**

```ts
// server/src/app.ts
import express from 'express';

export function createApp() {
  const app = express();
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json server/package.json server/tsconfig.json server/vitest.config.ts server/src/app.ts server/src/app.test.ts
git commit -m "chore: scaffold server workspace with healthz endpoint"
```

---

### Task 3: CLI Adapter — `safeExec`

**Files:**
- Create: `server/src/cli-adapter/exec.ts`
- Test: `server/src/cli-adapter/exec.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `safeExec(command: string, args: string[], options?: SafeExecOptions): Promise<string>` and `class SafeExecError extends Error { code: 'TIMEOUT' | 'NONZERO_EXIT' | 'OUTPUT_TOO_LARGE' | 'SPAWN_ERROR'; stderr?: string }` — used by Tasks 4 and 5.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/cli-adapter/exec.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { safeExec } from './exec.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

describe('safeExec', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it('resolves with stdout on success', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as any)(null, '{"ok":true}', '');
      return {} as any;
    });

    await expect(safeExec('gt', ['status', '--json'])).resolves.toBe('{"ok":true}');
  });

  it('rejects with a TIMEOUT SafeExecError when the process is killed by timeout', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      const err: any = new Error('Command timed out');
      err.killed = true;
      err.signal = 'SIGTERM';
      (cb as any)(err, '', '');
      return {} as any;
    });

    await expect(safeExec('gt', ['status'], { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('rejects with a NONZERO_EXIT SafeExecError and includes stderr', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      const err: any = new Error('Command failed');
      err.code = 1;
      (cb as any)(err, '', 'boom');
      return {} as any;
    });

    await expect(safeExec('gt', ['status'])).rejects.toMatchObject({
      code: 'NONZERO_EXIT',
      stderr: 'boom',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './exec.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/cli-adapter/exec.ts
import { execFile } from 'node:child_process';

export interface SafeExecOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
  cwd?: string;
}

export class SafeExecError extends Error {
  constructor(
    message: string,
    public readonly code: 'TIMEOUT' | 'NONZERO_EXIT' | 'OUTPUT_TOO_LARGE' | 'SPAWN_ERROR',
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'SafeExecError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

export function safeExec(
  command: string,
  args: string[],
  options: SafeExecOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer, cwd: options.cwd },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (err.killed && err.signal === 'SIGTERM') {
            reject(new SafeExecError(
              `Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
              'TIMEOUT',
              stderr
            ));
            return;
          }
          if (err.code === 'ENOBUFS' || /maxBuffer/.test(err.message)) {
            reject(new SafeExecError(
              `Command output exceeded ${maxBuffer} bytes: ${command} ${args.join(' ')}`,
              'OUTPUT_TOO_LARGE',
              stderr
            ));
            return;
          }
          if (typeof err.code === 'number') {
            reject(new SafeExecError(
              `Command exited with code ${err.code}: ${command} ${args.join(' ')}`,
              'NONZERO_EXIT',
              stderr
            ));
            return;
          }
          reject(new SafeExecError(`Failed to spawn command: ${command}`, 'SPAWN_ERROR', stderr));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/cli-adapter/exec.ts server/src/cli-adapter/exec.test.ts
git commit -m "feat: add safeExec CLI wrapper with timeout and output caps"
```

---

### Task 4: CLI Adapter — `gt.ts` typed wrappers

**Files:**
- Create: `server/src/cli-adapter/types.ts`
- Create: `server/src/cli-adapter/gt.ts`
- Test: `server/src/cli-adapter/gt.test.ts`
- Test (live, skipped by default): `server/src/cli-adapter/gt.contract.test.ts`

**Interfaces:**
- Consumes: `safeExec` from Task 3
- Produces: `getHook(): Promise<HookStatus>`, `getMailInbox(): Promise<MailMessage[]>`, `getRigList(): Promise<RigSummary[]>`, and the `HookStatus`/`MailMessage`/`RigSummary`/`BeadSummary` types — used by Tasks 6, 8, 9, 10.

Real CLI output shapes (verified against the live `gt` binary):

```bash
$ gt hook --json
{"target":"mayor/","role":"mayor","agent_bead_id":"hq-mayor","has_work":false,"is_wisp":false,"next_action":"..."}

$ gt mail inbox --json
[{"id":"...","from":"...","to":"...","subject":"...","body":"...","timestamp":"...","read":true,"priority":"high","type":"escalation", ...}]

$ gt rig list --json
[{"name":"allay","beads_prefix":"al","status":"operational","witness":"running","refinery":"stopped","polecats":0,"crew":0}]
```

- [ ] **Step 1: Define the types**

```ts
// server/src/cli-adapter/types.ts
export interface HookStatus {
  target: string;
  role: string;
  agent_bead_id: string;
  has_work: boolean;
  is_wisp: boolean;
  next_action: string;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  timestamp: string;
  read: boolean;
  priority: string;
  type: string;
}

export interface RigSummary {
  name: string;
  beads_prefix: string;
  status: string;
  witness: string;
  refinery: string;
  polecats: number;
  crew: number;
}

export interface BeadSummary {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
}
```

- [ ] **Step 2: Write the failing tests**

Each parser does a minimal runtime shape check (not full schema
validation, just enough to reject a plainly wrong shape like `null`, an
object where an array was expected, or a missing required field) rather
than trusting `JSON.parse(...) as T` blindly.

```ts
// server/src/cli-adapter/gt.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as execModule from './exec.js';
import { getHook, getMailInbox, getRigList } from './gt.js';

describe('gt.ts', () => {
  it('getHook() calls `gt hook --json` and parses the result', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
      target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor',
      has_work: false, is_wisp: false, next_action: 'wait',
    }));

    const result = await getHook();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['hook', '--json']);
    expect(result.role).toBe('mayor');
  });

  it('getHook() rejects when required fields are missing', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ role: 'mayor' }));
    await expect(getHook()).rejects.toThrow(/unexpected shape/i);
  });

  it('getMailInbox() calls `gt mail inbox --json` and parses an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { id: 'hq-1', from: 'deacon/', to: 'mayor/', subject: 'hi', timestamp: 't', read: false, priority: 'low', type: 'wisp' },
    ]));

    const result = await getMailInbox();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['mail', 'inbox', '--json']);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('hi');
  });

  it('getMailInbox() rejects when the CLI returns an object instead of an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ id: 'hq-1' }));
    await expect(getMailInbox()).rejects.toThrow(/unexpected shape/i);
  });

  it('getRigList() calls `gt rig list --json` and parses an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { name: 'allay', beads_prefix: 'al', status: 'operational', witness: 'running', refinery: 'stopped', polecats: 0, crew: 0 },
    ]));

    const result = await getRigList();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['rig', 'list', '--json']);
    expect(result[0].name).toBe('allay');
  });

  it('rejects when the CLI returns malformed JSON', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue('not json');
    await expect(getHook()).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './gt.js'`

- [ ] **Step 4: Implement**

```ts
// server/src/cli-adapter/gt.ts
import { safeExec } from './exec.js';
import type { HookStatus, MailMessage, RigSummary } from './types.js';

function parseHookStatus(raw: string): HookStatus {
  const value = JSON.parse(raw);
  if (
    typeof value !== 'object' || value === null ||
    typeof value.role !== 'string' || typeof value.has_work !== 'boolean'
  ) {
    throw new Error(`gt hook --json returned an unexpected shape: ${raw.slice(0, 200)}`);
  }
  return value as HookStatus;
}

function parseMailInbox(raw: string): MailMessage[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`gt mail inbox --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as MailMessage[];
}

function parseRigList(raw: string): RigSummary[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`gt rig list --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as RigSummary[];
}

export async function getHook(): Promise<HookStatus> {
  return parseHookStatus(await safeExec('gt', ['hook', '--json']));
}

export async function getMailInbox(): Promise<MailMessage[]> {
  return parseMailInbox(await safeExec('gt', ['mail', 'inbox', '--json']));
}

export async function getRigList(): Promise<RigSummary[]> {
  return parseRigList(await safeExec('gt', ['rig', 'list', '--json']));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 6: Add the live contract tests (skipped by default)**

```ts
// server/src/cli-adapter/gt.contract.test.ts
import { describe, it, expect } from 'vitest';
import { getHook, getMailInbox, getRigList } from './gt.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('gt.ts (live CLI contract)', () => {
  it('getHook() matches HookStatus against the real gt CLI', async () => {
    const result = await getHook();
    expect(typeof result.role).toBe('string');
    expect(typeof result.has_work).toBe('boolean');
    expect(typeof result.agent_bead_id).toBe('string');
  });

  it('getMailInbox() returns an array of messages with the expected fields', async () => {
    const result = await getMailInbox();
    expect(Array.isArray(result)).toBe(true);
    for (const message of result) {
      expect(typeof message.id).toBe('string');
      expect(typeof message.subject).toBe('string');
      expect(typeof message.read).toBe('boolean');
    }
  });

  it('getRigList() returns an array against the real gt CLI', async () => {
    const result = await getRigList();
    expect(Array.isArray(result)).toBe(true);
    for (const rig of result) {
      expect(typeof rig.name).toBe('string');
    }
  });
});
```

Run once manually to confirm it passes against this town: `ALLAY_LIVE_TESTS=1 npm run test --workspace server -- gt.contract.test.ts`

- [ ] **Step 7: Commit**

```bash
git add server/src/cli-adapter/types.ts server/src/cli-adapter/gt.ts server/src/cli-adapter/gt.test.ts server/src/cli-adapter/gt.contract.test.ts
git commit -m "feat: add typed gt CLI wrappers for hook, mail, rig list"
```

---

### Task 5: CLI Adapter — `bd.ts` typed wrapper

**Files:**
- Create: `server/src/cli-adapter/bd.ts`
- Test: `server/src/cli-adapter/bd.test.ts`
- Test (live, skipped by default): `server/src/cli-adapter/bd.contract.test.ts`

**Interfaces:**
- Consumes: `safeExec` from Task 3, `BeadSummary` from Task 4
- Produces: `listIssues(filter?: { status?: string }): Promise<BeadSummary[]>` — used by Tasks 6, 8, 9, 10.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/cli-adapter/bd.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as execModule from './exec.js';
import { listIssues } from './bd.js';

describe('bd.ts', () => {
  it('listIssues() calls `bd list --json` with no filter by default', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { id: 'al-1', title: 'Do a thing', status: 'open', priority: 2, issue_type: 'task' },
    ]));

    const result = await listIssues();
    expect(execModule.safeExec).toHaveBeenCalledWith('bd', ['list', '--json']);
    expect(result[0].id).toBe('al-1');
  });

  it('listIssues({ status }) appends a --status flag', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue('[]');
    await listIssues({ status: 'open' });
    expect(execModule.safeExec).toHaveBeenCalledWith('bd', ['list', '--json', '--status=open']);
  });

  it('listIssues() rejects when the CLI returns an object instead of an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ id: 'al-1' }));
    await expect(listIssues()).rejects.toThrow(/unexpected shape/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './bd.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/cli-adapter/bd.ts
import { safeExec } from './exec.js';
import type { BeadSummary } from './types.js';

export interface ListIssuesFilter {
  status?: string;
}

function parseBeadList(raw: string): BeadSummary[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`bd list --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as BeadSummary[];
}

export async function listIssues(filter: ListIssuesFilter = {}): Promise<BeadSummary[]> {
  const args = ['list', '--json'];
  if (filter.status) args.push(`--status=${filter.status}`);
  return parseBeadList(await safeExec('bd', args));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Add the live contract test**

```ts
// server/src/cli-adapter/bd.contract.test.ts
import { describe, it, expect } from 'vitest';
import { listIssues } from './bd.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('bd.ts (live CLI contract)', () => {
  it('listIssues() returns an array of beads with the expected fields', async () => {
    const result = await listIssues({ status: 'open' });
    expect(Array.isArray(result)).toBe(true);
    for (const bead of result) {
      expect(typeof bead.id).toBe('string');
      expect(typeof bead.title).toBe('string');
    }
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add server/src/cli-adapter/bd.ts server/src/cli-adapter/bd.test.ts server/src/cli-adapter/bd.contract.test.ts
git commit -m "feat: add typed bd CLI wrapper for issue listing"
```

---

### Task 6: Poll Scheduler — generic `Poller<T>`

**Files:**
- Create: `server/src/poll-scheduler/poller.ts`
- Test: `server/src/poll-scheduler/poller.test.ts`

**Interfaces:**
- Consumes: nothing (generic over any `() => Promise<T>` fetcher)
- Produces: `interface PollSnapshot<T> { data: T | null; lastSuccessAt: number | null; lastError: string | null; isStale: boolean }`, `interface Observable<T> { getSnapshot(): PollSnapshot<T>; onUpdate(cb: (s: PollSnapshot<T>) => void): () => void }`, and `class Poller<T> implements Observable<T>` with `start()`/`stop()` — used by Tasks 8, 9, 10.

Scheduling model (fixed cadence, skip-if-busy): each poll is followed by
a `intervalMs` (or backed-off) delay before the *next* poll starts; if a
poll is still running when its own next-scheduled tick fires, that tick
is skipped and rescheduled rather than queued. `stop()` must prevent any
further scheduling, including one already in flight when `stop()` is
called; `start()` while already running must not create a second timer
chain; a throwing subscriber must not stop other subscribers from being
notified or stop the next poll from being scheduled.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/poll-scheduler/poller.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Poller } from './poller.js';

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches immediately on start and caches the successful snapshot', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(poller.getSnapshot().data).toEqual({ ok: true });
    expect(poller.getSnapshot().isStale).toBe(false);
    expect(poller.getSnapshot().lastError).toBeNull();
  });

  it('keeps the cached data, marks stale, and doubles the delay on failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'));
    const poller = new Poller(fetcher, { intervalMs: 1000, backoffMaxMs: 8000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // success
    await vi.advanceTimersByTimeAsync(1000); // 1st failure, next delay -> 2000
    expect(poller.getSnapshot()).toMatchObject({ data: { ok: true }, isStale: true, lastError: 'boom' });

    await vi.advanceTimersByTimeAsync(2000); // 2nd failure, next delay -> 4000
    expect(poller.getSnapshot().lastError).toBe('boom again');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('resets the delay to intervalMs after a success following failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ n: 1 })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ n: 2 });
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // success (n:1)
    await vi.advanceTimersByTimeAsync(1000); // failure, delay -> 2000
    await vi.advanceTimersByTimeAsync(2000); // success (n:2), delay resets -> 1000
    await vi.advanceTimersByTimeAsync(1000); // next poll fires after only 1000ms, not 2000

    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('caps backoff at backoffMaxMs', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('always fails'));
    const poller = new Poller(fetcher, { intervalMs: 1000, backoffMaxMs: 3000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // fail, delay 1000 -> 2000
    await vi.advanceTimersByTimeAsync(2000); // fail, delay 2000 -> capped 3000
    await vi.advanceTimersByTimeAsync(3000); // fail, delay stays 3000
    expect(fetcher).toHaveBeenCalledTimes(3);
    // one more tick at exactly the capped delay must still fire
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not start a second fetch while one is in flight, and skips the due tick', async () => {
    let resolveFetch!: (v: { n: number }) => void;
    const fetcher = vi.fn(() => new Promise<{ n: number }>((resolve) => { resolveFetch = resolve; }));
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // due tick while in-flight: skipped

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch({ n: 1 });
  });

  it('stop() prevents scheduling even if a fetch was already in flight', async () => {
    let resolveFetch!: (v: { n: number }) => void;
    const fetcher = vi.fn(() => new Promise<{ n: number }>((resolve) => { resolveFetch = resolve; }));
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // fetch #1 starts, still pending
    poller.stop();
    resolveFetch({ n: 1 }); // fetch #1 resolves after stop()
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000); // no further ticks should fire

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('start() called twice does not create a duplicate timer chain', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    poller.start();
    poller.start(); // second call must be a no-op while already running
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetcher).toHaveBeenCalledTimes(2); // one immediate + one interval tick, not two of each
  });

  it('notifies subscribers on every poll and stops notifying after unsubscribe', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    const seen: unknown[] = [];
    const unsubscribe = poller.onUpdate((snapshot) => seen.push(snapshot.data));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toHaveLength(1);
  });

  it('a throwing subscriber does not stop other subscribers from being notified or the next poll from being scheduled', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const poller = new Poller(fetcher, { intervalMs: 1000 });
    const seen: unknown[] = [];
    poller.onUpdate(() => { throw new Error('subscriber bug'); });
    poller.onUpdate((snapshot) => seen.push(snapshot.data));

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './poller.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/poll-scheduler/poller.ts
export interface PollSnapshot<T> {
  data: T | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  isStale: boolean;
}

export interface Observable<T> {
  getSnapshot(): PollSnapshot<T>;
  onUpdate(cb: (snapshot: PollSnapshot<T>) => void): () => void;
}

export interface PollerOptions {
  intervalMs: number;
  backoffMaxMs?: number;
}

export class Poller<T> implements Observable<T> {
  private snapshot: PollSnapshot<T> = { data: null, lastSuccessAt: null, lastError: null, isStale: true };
  private listeners = new Set<(snapshot: PollSnapshot<T>) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private running = false;
  private currentDelay: number;

  constructor(private fetcher: () => Promise<T>, private options: PollerOptions) {
    this.currentDelay = options.intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getSnapshot(): PollSnapshot<T> {
    return this.snapshot;
  }

  onUpdate(cb: (snapshot: PollSnapshot<T>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private scheduleNext(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      if (this.running) this.scheduleNext(this.options.intervalMs);
      return;
    }
    this.inFlight = true;
    try {
      const data = await this.fetcher();
      this.currentDelay = this.options.intervalMs;
      this.snapshot = { data, lastSuccessAt: Date.now(), lastError: null, isStale: false };
    } catch (err) {
      const backoffMax = this.options.backoffMaxMs ?? this.options.intervalMs * 8;
      this.snapshot = {
        ...this.snapshot,
        lastError: err instanceof Error ? err.message : String(err),
        isStale: true,
      };
      this.currentDelay = Math.min(this.currentDelay * 2, backoffMax);
    } finally {
      this.inFlight = false;
      for (const listener of this.listeners) {
        try {
          listener(this.snapshot);
        } catch {
          // A broken subscriber must not stop other subscribers or scheduling.
        }
      }
      if (this.running) this.scheduleNext(this.currentDelay);
    }
  }
}
```

Note on the backoff-doubling test: the delay used for the *next* schedule
is computed from the delay that was already in effect for the poll that
just failed, then doubled — so after failure #1 (starting from
`intervalMs`), the next delay is `intervalMs * 2`; after failure #2, it's
`intervalMs * 4`, capped at `backoffMaxMs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/poll-scheduler/poller.ts server/src/poll-scheduler/poller.test.ts
git commit -m "feat: add generic Poller with caching, backoff, and safe stop/start"
```

---

### Task 7: Auth — local token file + Host/Origin checks + middleware

**Files:**
- Create: `server/src/auth/token.ts`
- Test: `server/src/auth/token.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getOrCreateToken(filePath: string): string`, `tokenMiddleware(getToken: () => string): express.RequestHandler`, `hostMiddleware(): express.RequestHandler`, `verifyWsToken(getToken: () => string, req: IncomingMessage): boolean`, `isAllowedLocalOrigin(origin: string | undefined): boolean`, `isAllowedLocalHost(host: string | undefined): boolean` — used by Tasks 8, 9, 10.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/auth/token.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  getOrCreateToken,
  tokenMiddleware,
  hostMiddleware,
  verifyWsToken,
  isAllowedLocalOrigin,
  isAllowedLocalHost,
} from './token.js';

describe('getOrCreateToken', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'allay-token-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a token file if none exists and returns a non-empty token', () => {
    const filePath = join(dir, 'nested', 'token');
    const token = getOrCreateToken(filePath);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(filePath, 'utf8').trim()).toBe(token);
  });

  it('returns the same token on a second call', () => {
    const filePath = join(dir, 'token');
    const first = getOrCreateToken(filePath);
    const second = getOrCreateToken(filePath);
    expect(second).toBe(first);
  });

  it('regenerates when the existing file is empty', () => {
    const filePath = join(dir, 'token');
    writeFileSync(filePath, '');
    const token = getOrCreateToken(filePath);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('tokenMiddleware', () => {
  function buildApp() {
    const app = express();
    app.use(tokenMiddleware(() => 'expected-token'));
    app.get('/protected', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests with the correct token', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'expected-token');
    expect(res.status).toBe(200);
  });

  it('rejects requests with no token', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an incorrect token of the same length', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'wrong-token!');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an incorrect token of a different length', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'short');
    expect(res.status).toBe(401);
  });
});

describe('hostMiddleware', () => {
  function buildApp() {
    const app = express();
    app.use(hostMiddleware());
    app.get('/anything', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests with a loopback Host header', async () => {
    const res = await request(buildApp()).get('/anything').set('Host', '127.0.0.1:4317');
    expect(res.status).toBe(200);
  });

  it('rejects requests with a non-local Host header', async () => {
    const res = await request(buildApp()).get('/anything').set('Host', 'evil.example.com');
    expect(res.status).toBe(400);
  });
});

describe('verifyWsToken', () => {
  it('accepts a request whose query token matches', () => {
    const req = { url: '/ws?token=expected-token' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(true);
  });

  it('rejects a request with no token', () => {
    const req = { url: '/ws' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(false);
  });

  it('rejects a request with an incorrect token', () => {
    const req = { url: '/ws?token=wrong-token' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(false);
  });
});

describe('isAllowedLocalOrigin', () => {
  it('accepts http(s) origins on 127.0.0.1 or localhost, any port', () => {
    expect(isAllowedLocalOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedLocalOrigin('http://localhost:4317')).toBe(true);
    expect(isAllowedLocalOrigin('https://localhost')).toBe(true);
  });

  it('rejects missing, malformed, or non-local origins', () => {
    expect(isAllowedLocalOrigin(undefined)).toBe(false);
    expect(isAllowedLocalOrigin('not-a-url')).toBe(false);
    expect(isAllowedLocalOrigin('http://evil.example.com')).toBe(false);
  });
});

describe('isAllowedLocalHost', () => {
  it('accepts loopback hosts with or without a port', () => {
    expect(isAllowedLocalHost('127.0.0.1:4317')).toBe(true);
    expect(isAllowedLocalHost('localhost')).toBe(true);
  });

  it('rejects missing or non-local hosts', () => {
    expect(isAllowedLocalHost(undefined)).toBe(false);
    expect(isAllowedLocalHost('evil.example.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './token.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/auth/token.ts
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

export function getOrCreateToken(filePath: string): string {
  try {
    const existing = readFileSync(filePath, 'utf8').trim();
    if (existing.length > 0) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(filePath, token, { mode: 0o600, flag: 'wx' });
    return token;
  } catch (err) {
    // Another process won the race and created it first (or it was an
    // empty file we're now overwriting) — re-read rather than trust our
    // own write blindly.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST' && existsSync(filePath)) {
      const winner = readFileSync(filePath, 'utf8').trim();
      if (winner.length > 0) return winner;
    }
    throw err;
  }
}

function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function tokenMiddleware(getToken: () => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.header('x-allay-token');
    if (!provided || !safeTokenEquals(provided, getToken())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return LOCAL_ORIGIN_PATTERN.test(origin);
}

export function isAllowedLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOST_PATTERN.test(host);
}

export function hostMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedLocalHost(req.header('host'))) {
      res.status(400).json({ error: 'bad host' });
      return;
    }
    next();
  };
}

export function verifyWsToken(getToken: () => string, req: IncomingMessage): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  const provided = url.searchParams.get('token');
  return provided !== null && safeTokenEquals(provided, getToken());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/token.ts server/src/auth/token.test.ts
git commit -m "feat: add local auth token, Host/Origin checks, and timing-safe compare"
```

---

### Task 8: REST API — routes wiring pollers behind Host+auth

**Files:**
- Modify: `server/src/app.ts` (accept pollers + token, mount Host check + router)
- Create: `server/src/api/routes.ts`
- Modify: `server/src/app.test.ts` (update for new `createApp` signature)
- Test: `server/src/api/routes.test.ts`

**Interfaces:**
- Consumes: `Observable<T>` from Task 6, `tokenMiddleware`/`hostMiddleware` from Task 7, `HookStatus`/`MailMessage`/`RigSummary`/`BeadSummary` from Task 4
- Produces: `interface PollerMap { hook: Observable<HookStatus>; mail: Observable<MailMessage[]>; rigs: Observable<RigSummary[]>; beads: Observable<BeadSummary[]> }`, `createApiRouter(pollers: PollerMap, getToken: () => string): express.Router`, and updated `createApp(pollers: PollerMap, getToken: () => string): express.Express` — used by Tasks 9, 10.

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/api/routes.test.ts
import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';
import { createApiRouter, type PollerMap } from './routes.js';
import type { PollSnapshot } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';

function fakeSource<T>(snapshot: PollSnapshot<T>) {
  return { getSnapshot: () => snapshot, onUpdate: () => () => {} };
}

function buildPollers(): PollerMap {
  return {
    hook: fakeSource<HookStatus>({ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }),
    mail: fakeSource<MailMessage[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    rigs: fakeSource<RigSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    beads: fakeSource<BeadSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
  };
}

describe('createApiRouter', () => {
  const token = 'test-token';

  function buildApp() {
    const app = express();
    app.use('/api', createApiRouter(buildPollers(), () => token));
    return app;
  }

  it('returns the hook snapshot when the token matches', async () => {
    const res = await request(buildApp()).get('/api/status/hook').set('x-allay-token', token);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('mayor');
  });

  it('returns 401 without a valid token', async () => {
    const res = await request(buildApp()).get('/api/status/hook');
    expect(res.status).toBe(401);
  });

  it.each(['hook', 'mail', 'rigs', 'beads'])('exposes a %s route', async (resource) => {
    const res = await request(buildApp()).get(`/api/status/${resource}`).set('x-allay-token', token);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './routes.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/api/routes.ts
import { Router } from 'express';
import { tokenMiddleware } from '../auth/token.js';
import type { Observable } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';

export interface PollerMap {
  hook: Observable<HookStatus>;
  mail: Observable<MailMessage[]>;
  rigs: Observable<RigSummary[]>;
  beads: Observable<BeadSummary[]>;
}

export function createApiRouter(pollers: PollerMap, getToken: () => string): Router {
  const router = Router();
  router.use(tokenMiddleware(getToken));

  router.get('/status/hook', (_req, res) => res.json(pollers.hook.getSnapshot()));
  router.get('/status/mail', (_req, res) => res.json(pollers.mail.getSnapshot()));
  router.get('/status/rigs', (_req, res) => res.json(pollers.rigs.getSnapshot()));
  router.get('/status/beads', (_req, res) => res.json(pollers.beads.getSnapshot()));

  return router;
}
```

```ts
// server/src/app.ts
import express from 'express';
import { createApiRouter, type PollerMap } from './api/routes.js';
import { hostMiddleware } from './auth/token.js';

export function createApp(pollers: PollerMap, getToken: () => string) {
  const app = express();
  app.use(hostMiddleware());
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', createApiRouter(pollers, getToken));
  return app;
}
```

```ts
// server/src/app.test.ts
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { PollerMap } from './api/routes.js';

function fakeSource<T>(data: T) {
  return {
    getSnapshot: () => ({ data, lastSuccessAt: 1, lastError: null, isStale: false }),
    onUpdate: () => () => {},
  };
}

function buildPollers(): PollerMap {
  return {
    hook: fakeSource({ target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }),
    mail: fakeSource([]),
    rigs: fakeSource([]),
    beads: fakeSource([]),
  };
}

describe('createApp', () => {
  const token = 'test-token';

  it('responds to /healthz without requiring the token (Host is still checked by supertest\'s default 127.0.0.1 Host header)', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('rejects /healthz when the Host header is not local', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/healthz').set('Host', 'evil.example.com');
    expect(res.status).toBe(400);
  });

  it('serves /api routes behind the token', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/api/status/hook').set('x-allay-token', token);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes.ts server/src/api/routes.test.ts server/src/app.ts server/src/app.test.ts
git commit -m "feat: add Host- and token-gated REST routes for monitor snapshots"
```

---

### Task 9: WebSocket — snapshot broadcast server

**Files:**
- Create: `server/src/api/ws.ts`
- Test: `server/src/api/ws.test.ts`

**Interfaces:**
- Consumes: `Observable<T>` from Task 6, `verifyWsToken`/`isAllowedLocalOrigin`/`isAllowedLocalHost` from Task 7, `PollerMap` from Task 8, `HookStatus`/`MailMessage`/`RigSummary`/`BeadSummary` from Task 4
- Produces: `attachSnapshotSocket(server: http.Server, pollers: PollerMap, getToken: () => string): WebSocketServer` and a discriminated `SnapshotMessage` union — used by Task 10 and by the client (Task 11).

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/api/ws.test.ts
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { attachSnapshotSocket } from './ws.js';
import type { PollSnapshot, Observable } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';
import type { PollerMap } from './routes.js';

function fakeObservable<T>(initial: PollSnapshot<T>): Observable<T> & { emit: (s: PollSnapshot<T>) => void; unsubscribeCount: number } {
  let current = initial;
  const listeners = new Set<(s: PollSnapshot<T>) => void>();
  const state = {
    getSnapshot: () => current,
    onUpdate: (cb: (s: PollSnapshot<T>) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        state.unsubscribeCount += 1;
      };
    },
    emit: (next: PollSnapshot<T>) => { current = next; listeners.forEach((cb) => cb(next)); },
    unsubscribeCount: 0,
  };
  return state;
}

function buildPollers(): PollerMap & { hook: ReturnType<typeof fakeObservable<HookStatus>> } {
  return {
    hook: fakeObservable<HookStatus>({ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }),
    mail: fakeObservable<MailMessage[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    rigs: fakeObservable<RigSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    beads: fakeObservable<BeadSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
  };
}

function nextNMessages(ws: WebSocket, n: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === n) resolve(messages);
    });
  });
}

async function startServer(pollers: PollerMap) {
  const server = createServer();
  attachSnapshotSocket(server, pollers, () => 'tok');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

describe('attachSnapshotSocket', () => {
  it('sends all four initial snapshots on connect', async () => {
    const pollers = buildPollers();
    const { server, port } = await startServer(pollers);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const initial = nextNMessages(ws, 4);
    await new Promise<void>((resolve) => ws.on('open', resolve));
    const messages = await initial;

    expect(new Set(messages.map((m) => m.resource))).toEqual(new Set(['hook', 'mail', 'rigs', 'beads']));

    ws.close();
    server.close();
  });

  it('broadcasts an update to a connected client', async () => {
    const pollers = buildPollers();
    const { server, port } = await startServer(pollers);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const first4 = nextNMessages(ws, 4);
    await new Promise<void>((resolve) => ws.on('open', resolve));
    await first4;

    const next = nextNMessages(ws, 1);
    pollers.hook.emit({ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: true, is_wisp: false, next_action: '' }, lastSuccessAt: 2, lastError: null, isStale: false });
    const [update] = await next;

    expect(update.resource).toBe('hook');
    expect(update.snapshot.data.has_work).toBe(true);

    ws.close();
    server.close();
  });

  it('broadcasts to two simultaneous clients independently', async () => {
    const pollers = buildPollers();
    const { server, port } = await startServer(pollers);

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const initialA = nextNMessages(wsA, 4);
    const initialB = nextNMessages(wsB, 4);
    await Promise.all([
      new Promise<void>((resolve) => wsA.on('open', resolve)),
      new Promise<void>((resolve) => wsB.on('open', resolve)),
    ]);
    await Promise.all([initialA, initialB]);

    const nextA = nextNMessages(wsA, 1);
    const nextB = nextNMessages(wsB, 1);
    pollers.mail.emit({ data: [{ id: 'hq-1', from: 'deacon/', to: 'mayor/', subject: 'hi', timestamp: 't', read: false, priority: 'low', type: 'wisp' }], lastSuccessAt: 3, lastError: null, isStale: false });
    const [updateA] = await nextA;
    const [updateB] = await nextB;

    expect(updateA.resource).toBe('mail');
    expect(updateB.resource).toBe('mail');

    wsA.close();
    wsB.close();
    server.close();
  });

  it('unsubscribes from all pollers when a client disconnects', async () => {
    const pollers = buildPollers();
    const { server, port } = await startServer(pollers);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const initial = nextNMessages(ws, 4);
    await new Promise<void>((resolve) => ws.on('open', resolve));
    await initial;

    ws.close();
    await new Promise<void>((resolve) => ws.on('close', resolve));
    await new Promise((r) => setTimeout(r, 10)); // let the server's close handler run

    expect(pollers.hook.unsubscribeCount).toBe(1);

    server.close();
  });

  it('destroys the connection when the token is missing or wrong', async () => {
    const { server, port } = await startServer(buildPollers());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
    const closedOrErrored = await new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
    });

    expect(closedOrErrored).toBe(true);
    server.close();
  });

  it('destroys the connection when the Origin header is not a local origin', async () => {
    const { server, port } = await startServer(buildPollers());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`, {
      headers: { origin: 'http://evil.example.com' },
    });
    const closedOrErrored = await new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
    });

    expect(closedOrErrored).toBe(true);
    server.close();
  });

  it('destroys the connection when the Host header is not local', async () => {
    const { server, port } = await startServer(buildPollers());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`, {
      headers: { host: 'evil.example.com' },
    });
    const closedOrErrored = await new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
    });

    expect(closedOrErrored).toBe(true);
    server.close();
  });

  it('destroys the connection for a path that only starts with /ws', async () => {
    const { server, port } = await startServer(buildPollers());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws-not-this?token=tok`);
    const closedOrErrored = await new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
    });

    expect(closedOrErrored).toBe(true);
    server.close();
  });

  it('accepts a connection with no Origin header at all (non-browser client)', async () => {
    const { server, port } = await startServer(buildPollers());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.close();
    server.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './ws.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/api/ws.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyWsToken, isAllowedLocalOrigin, isAllowedLocalHost } from '../auth/token.js';
import type { PollSnapshot } from '../poll-scheduler/poller.js';
import type { PollerMap } from './routes.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';

export type SnapshotMessage =
  | { type: 'snapshot'; resource: 'hook'; snapshot: PollSnapshot<HookStatus> }
  | { type: 'snapshot'; resource: 'mail'; snapshot: PollSnapshot<MailMessage[]> }
  | { type: 'snapshot'; resource: 'rigs'; snapshot: PollSnapshot<RigSummary[]> }
  | { type: 'snapshot'; resource: 'beads'; snapshot: PollSnapshot<BeadSummary[]> };

export function attachSnapshotSocket(
  server: Server,
  pollers: PollerMap,
  getToken: () => string
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const origin = req.headers.origin;
    const originAllowed = !origin || isAllowedLocalOrigin(origin);

    if (
      url.pathname !== '/ws' ||
      !isAllowedLocalHost(req.headers.host) ||
      !verifyWsToken(getToken, req) ||
      !originAllowed
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const unsubscribers: Array<() => void> = [];

    function wire<K extends keyof PollerMap>(resource: K) {
      const source = pollers[resource];
      const send = (snapshot: PollSnapshot<unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'snapshot', resource, snapshot } as SnapshotMessage));
        }
      };
      send(source.getSnapshot());
      unsubscribers.push(source.onUpdate(send));
    }

    wire('hook');
    wire('mail');
    wire('rigs');
    wire('beads');

    ws.on('close', () => unsubscribers.forEach((unsub) => unsub()));
  });

  return wss;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/api/ws.ts server/src/api/ws.test.ts
git commit -m "feat: add Host/Origin/token-gated WebSocket snapshot broadcaster"
```

---

### Task 10: Server Wiring — composition root + dev proxy + manual smoke test

**Files:**
- Create: `server/src/index.ts`

(Task 10 does not create any client files — `client/` doesn't exist yet.
It only fixes the server port this task's smoke test and Task 11's dev
proxy must agree on; Task 11 is what actually creates `client/vite.config.ts`.)

**Interfaces:**
- Consumes: `getHook`/`getMailInbox`/`getRigList` (Task 4), `listIssues` (Task 5), `Poller` (Task 6), `getOrCreateToken` (Task 7), `createApp` (Task 8), `attachSnapshotSocket` (Task 9)
- Produces: a running process, and the dev-proxy target port (`4317`)
  that Task 11's Vite config points at. No code interface is consumed by
  other server tasks.

This task has no automated test: it wires real CLI adapters into
pollers, which would make `npm test` depend on `gt`/`bd`/Dolt being
present. It is verified with the manual smoke test below instead.

- [ ] **Step 1: Implement the composition root**

Note the typing here: `pollers` is built and typed as a plain object of
concrete `Poller<T>` instances (so `.start()` is available on each
without a cast), and that same object is passed to `createApp`/
`attachSnapshotSocket`, which only need the narrower `Observable<T>`
surface — no cast is needed either way because `Poller<T>` structurally
implements `Observable<T>`.

```ts
// server/src/index.ts
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { attachSnapshotSocket } from './api/ws.js';
import { getOrCreateToken } from './auth/token.js';
import { getHook, getMailInbox, getRigList } from './cli-adapter/gt.js';
import { listIssues } from './cli-adapter/bd.js';
import { Poller } from './poll-scheduler/poller.js';

const PORT = Number(process.env.ALLAY_PORT ?? 4317);
const TOKEN_PATH = process.env.ALLAY_TOKEN_PATH ?? path.join(os.homedir(), '.allay', 'token');

const token = getOrCreateToken(TOKEN_PATH);

const pollers = {
  hook: new Poller(getHook, { intervalMs: 3000 }),
  mail: new Poller(getMailInbox, { intervalMs: 5000 }),
  rigs: new Poller(getRigList, { intervalMs: 5000 }),
  beads: new Poller(() => listIssues({ status: 'open' }), { intervalMs: 5000 }),
};

pollers.hook.start();
pollers.mail.start();
pollers.rigs.start();
pollers.beads.start();

const app = createApp(pollers, () => token);
const server = createServer(app);
attachSnapshotSocket(server, pollers, () => token);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Allay server listening on http://127.0.0.1:${PORT} (loopback only)`);
  console.log(`Open the client once with ?token=${token} — it's then remembered in localStorage.`);
});
```

- [ ] **Step 2: Decide and record the dev-proxy target**

The client (Task 11 onward) will proxy `/api` and `/ws` to
`http://127.0.0.1:4317` from Vite's dev server, so the browser only ever
talks to Vite's own origin — no CORS, no preflight on the custom token
header. Record this as the contract between server and client: **the
server's `/api/*` and `/ws` paths are proxied verbatim; the port
(`4317`, or `$ALLAY_PORT`) must match `client/vite.config.ts`'s proxy
target set up in Task 11.**

- [ ] **Step 3: Manual smoke test**

Run from `server/`:

```bash
npm run dev
```

In another terminal:

```bash
curl -s -H "Host: 127.0.0.1:4317" http://127.0.0.1:4317/healthz
# {"status":"ok"}

TOKEN=$(cat ~/.allay/token)
curl -s -H "x-allay-token: $TOKEN" http://127.0.0.1:4317/api/status/hook
curl -s -H "x-allay-token: $TOKEN" http://127.0.0.1:4317/api/status/rigs
curl -s http://127.0.0.1:4317/api/status/hook
# expect 401 without the header
curl -s -H "Host: evil.example.com" http://127.0.0.1:4317/healthz
# expect 400 (bad host)
```

Confirm the `hook`/`rigs`/`mail`/`beads` responses match live
`gt hook --json` / `gt rig list --json` / `gt mail inbox --json` /
`bd list --status=open --json` output (allow a few seconds for the
first poll).

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: wire real CLI pollers into the server composition root"
```

---

### Task 11: Client Scaffolding — Vite/React + dev proxy + API client

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/vitest.config.ts`, `client/index.html`
- Create: `client/src/vite-env.d.ts`
- Create: `client/src/api/types.ts`
- Create: `client/src/api/client.ts`
- Test: `client/src/api/client.test.ts`

**Interfaces:**
- Consumes: nothing new (mirrors server types for `PollSnapshot<T>`,
  `HookStatus`, `MailMessage`, `RigSummary`, `BeadSummary`, and the
  discriminated `SnapshotMessage` union — duplicated intentionally to
  avoid a shared-package dependency for four small interfaces)
- Produces: `resolveToken(location?: Location): string | null`,
  `apiFetch<T>(path: string): Promise<T>`, `class MissingTokenError
  extends Error` — used by Task 14. **`main.tsx` and `App` are created in
  Task 13/14, not here** — this task is buildable and testable entirely
  on its own.

- [ ] **Step 1: Client package config**

```json
// client/package.json
{
  "name": "@allay/client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`build` runs `tsc --noEmit` first specifically because `vite build` alone
does not typecheck — a broken type (e.g. a bad `import.meta.env` usage)
would otherwise ship silently.

- [ ] **Step 2: Vite config with the dev proxy**

```ts
// client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_ORIGIN = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: SERVER_ORIGIN, ws: true, changeOrigin: true },
    },
  },
});
```

With this proxy, the browser only ever calls its own origin
(`http://127.0.0.1:<vite-port>/api/...` and `/ws`), which Vite forwards
to the server — no cross-origin request, no CORS, no preflight on the
`x-allay-token` header.

```ts
// client/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
```

```ts
// client/src/test-setup.ts
import '@testing-library/jest-dom/vitest';
```

```json
// client/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```ts
// client/src/vite-env.d.ts
/// <reference types="vite/client" />
```

```html
<!-- client/index.html -->
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Allay</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`main.tsx` doesn't exist yet — it's created in Task 13 alongside `App`,
so this task never references a not-yet-existing module. `index.html`
referencing it ahead of time is fine; it's only loaded once a dev server
actually serves the page, by which point Task 13 will have run.

- [ ] **Step 3: Shared client types**

```ts
// client/src/api/types.ts
export interface PollSnapshot<T> {
  data: T | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  isStale: boolean;
}

export interface HookStatus {
  target: string;
  role: string;
  agent_bead_id: string;
  has_work: boolean;
  is_wisp: boolean;
  next_action: string;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  timestamp: string;
  read: boolean;
  priority: string;
  type: string;
}

export interface RigSummary {
  name: string;
  beads_prefix: string;
  status: string;
  witness: string;
  refinery: string;
  polecats: number;
  crew: number;
}

export interface BeadSummary {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
}

export type SnapshotMessage =
  | { type: 'snapshot'; resource: 'hook'; snapshot: PollSnapshot<HookStatus> }
  | { type: 'snapshot'; resource: 'mail'; snapshot: PollSnapshot<MailMessage[]> }
  | { type: 'snapshot'; resource: 'rigs'; snapshot: PollSnapshot<RigSummary[]> }
  | { type: 'snapshot'; resource: 'beads'; snapshot: PollSnapshot<BeadSummary[]> };
```

- [ ] **Step 4: Write the failing tests**

```ts
// client/src/api/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveToken, apiFetch, MissingTokenError } from './client';

describe('resolveToken', () => {
  beforeEach(() => localStorage.clear());

  it('stores and returns the token found in the URL query string', () => {
    const location = { search: '?token=abc123' } as Location;
    expect(resolveToken(location)).toBe('abc123');
    expect(localStorage.getItem('allay-token')).toBe('abc123');
  });

  it('falls back to the stored token when the URL has none', () => {
    localStorage.setItem('allay-token', 'stored-token');
    expect(resolveToken({ search: '' } as Location)).toBe('stored-token');
  });

  it('returns null when there is no token anywhere', () => {
    expect(resolveToken({ search: '' } as Location)).toBeNull();
  });
});

describe('apiFetch', () => {
  beforeEach(() => localStorage.clear());

  it('throws MissingTokenError when no token is available', async () => {
    await expect(apiFetch('/api/status/hook')).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('sends the token header against a same-origin relative path and returns parsed JSON', async () => {
    localStorage.setItem('allay-token', 'tok');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 42 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ data: number }>('/api/status/hook');
    expect(result).toEqual({ data: 42 });
    expect(fetchMock).toHaveBeenCalledWith('/api/status/hook', { headers: { 'x-allay-token': 'tok' } });
  });

  it('throws when the response is not ok', async () => {
    localStorage.setItem('allay-token', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(apiFetch('/api/status/hook')).rejects.toThrow('401');
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 6: Implement**

`apiFetch` takes a same-origin relative path (`/api/...`), not a base
URL — the dev proxy (and, in production, serving the built client from
the same server) is what makes this work without CORS.

```ts
// client/src/api/client.ts
const TOKEN_STORAGE_KEY = 'allay-token';

export function resolveToken(location: Location = window.location): string | null {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) {
    localStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export class MissingTokenError extends Error {
  constructor() {
    super('No Allay auth token found. Open the app once with ?token=<token> from the server startup log.');
  }
}

export async function apiFetch<T>(path: string): Promise<T> {
  const token = resolveToken();
  if (!token) throw new MissingTokenError();

  const res = await fetch(path, { headers: { 'x-allay-token': token } });
  if (!res.ok) throw new Error(`Request to ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/package.json client/tsconfig.json client/vite.config.ts client/vitest.config.ts client/index.html client/src/vite-env.d.ts client/src/test-setup.ts client/src/api/types.ts client/src/api/client.ts client/src/api/client.test.ts
git commit -m "chore: scaffold client workspace with dev proxy and auth-aware API client"
```

---

### Task 12: Client — `SnapshotCard` component (loading/data/stale/error)

**Files:**
- Create: `client/src/components/SnapshotCard.tsx`
- Test: `client/src/components/SnapshotCard.test.tsx`

**Interfaces:**
- Consumes: `PollSnapshot<T>` from Task 11
- Produces: `function SnapshotCard<T>(props: { title: string; snapshot: PollSnapshot<T> | null; renderData: (data: T) => ReactNode }): JSX.Element` — used by Task 13. Four distinct visual states: **loading** (no snapshot yet, no error), **error** (no data yet, but a poll failed), **fresh** (data present, not stale), **stale** (data present, but the most recent poll failed).

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/SnapshotCard.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SnapshotCard } from './SnapshotCard';

describe('SnapshotCard', () => {
  it('shows a loading state when there is no snapshot yet and no error', () => {
    render(<SnapshotCard title="Hook" snapshot={null} renderData={() => null} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state when there is no data yet but a poll already failed', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: null, lastSuccessAt: null, lastError: 'gt not found', isStale: true }}
        renderData={() => null}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('gt not found');
  });

  it('renders data, no stale warning, and the last-updated time when fresh', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: { role: 'mayor' }, lastSuccessAt: 1700000000000, lastError: null, isStale: false }}
        renderData={(data) => <p>{data.role}</p>}
      />
    );
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('shows a stale warning with the last error when data exists but the latest poll failed', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: { role: 'mayor' }, lastSuccessAt: 1700000000000, lastError: 'boom', isStale: true }}
        renderData={(data) => <p>{data.role}</p>}
      />
    );
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './SnapshotCard'`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/SnapshotCard.tsx
import type { ReactNode } from 'react';
import type { PollSnapshot } from '../api/types';

export interface SnapshotCardProps<T> {
  title: string;
  snapshot: PollSnapshot<T> | null;
  renderData: (data: T) => ReactNode;
}

export function SnapshotCard<T>({ title, snapshot, renderData }: SnapshotCardProps<T>) {
  if (!snapshot || (snapshot.data === null && !snapshot.lastError)) {
    return (
      <section aria-label={title}>
        <h2>{title}</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (snapshot.data === null) {
    return (
      <section aria-label={title}>
        <h2>{title}</h2>
        <p role="alert">{snapshot.lastError}</p>
      </section>
    );
  }

  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {snapshot.isStale && (
        <p role="alert">Stale data{snapshot.lastError ? `: ${snapshot.lastError}` : ''}</p>
      )}
      {renderData(snapshot.data)}
      {snapshot.lastSuccessAt && (
        <p>Updated {new Date(snapshot.lastSuccessAt).toLocaleTimeString()}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SnapshotCard.tsx client/src/components/SnapshotCard.test.tsx
git commit -m "feat: add SnapshotCard with loading/error/fresh/stale states"
```

---

### Task 13: Client — `Dashboard` component (pure rendering)

**Files:**
- Create: `client/src/components/Dashboard.tsx`
- Test: `client/src/components/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `SnapshotCard` from Task 12, types from Task 11
- Produces: `function Dashboard(props: DashboardProps): JSX.Element` — a
  pure presentational component with no data-fetching of its own, used
  by Task 14's `App`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Dashboard.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
  it('renders all four sections with their data', () => {
    render(
      <Dashboard
        hook={{ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }}
        mail={{ data: [{ id: 'hq-1', from: 'deacon/', to: 'mayor/', subject: 'Wisp Compaction', timestamp: 't', read: false, priority: 'low', type: 'wisp' }], lastSuccessAt: 1, lastError: null, isStale: false }}
        rigs={{ data: [{ name: 'allay', beads_prefix: 'al', status: 'operational', witness: 'running', refinery: 'stopped', polecats: 0, crew: 0 }], lastSuccessAt: 1, lastError: null, isStale: false }}
        beads={{ data: [{ id: 'al-1', title: 'Do a thing', status: 'open', priority: 2, issue_type: 'task' }], lastSuccessAt: 1, lastError: null, isStale: false }}
      />
    );

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText(/Wisp Compaction/)).toBeInTheDocument();
    expect(screen.getByText(/allay: witness=running/)).toBeInTheDocument();
    expect(screen.getByText(/al-1: Do a thing/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './Dashboard'`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/Dashboard.tsx
import { SnapshotCard } from './SnapshotCard';
import type { PollSnapshot, HookStatus, MailMessage, RigSummary, BeadSummary } from '../api/types';

export interface DashboardProps {
  hook: PollSnapshot<HookStatus> | null;
  mail: PollSnapshot<MailMessage[]> | null;
  rigs: PollSnapshot<RigSummary[]> | null;
  beads: PollSnapshot<BeadSummary[]> | null;
}

export function Dashboard({ hook, mail, rigs, beads }: DashboardProps) {
  return (
    <div className="dashboard">
      <SnapshotCard title="Hook" snapshot={hook} renderData={(data) => (
        <p>{data.has_work ? `Working: ${data.agent_bead_id}` : 'Idle'}</p>
      )} />
      <SnapshotCard title="Mail" snapshot={mail} renderData={(data) => (
        <ul>{data.slice(0, 5).map((m) => <li key={m.id}>{m.read ? '' : '● '}{m.subject}</li>)}</ul>
      )} />
      <SnapshotCard title="Rigs" snapshot={rigs} renderData={(data) => (
        <ul>{data.map((r) => <li key={r.name}>{r.name}: witness={r.witness}, refinery={r.refinery}</li>)}</ul>
      )} />
      <SnapshotCard title="Beads" snapshot={beads} renderData={(data) => (
        <ul>{data.slice(0, 10).map((b) => <li key={b.id}>{b.id}: {b.title}</li>)}</ul>
      )} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Dashboard.tsx client/src/components/Dashboard.test.tsx
git commit -m "feat: add Dashboard rendering hook/mail/rigs/beads sections"
```

---

### Task 14: Client — WS connection lifecycle, `App`, and final smoke test

**Files:**
- Create: `client/src/api/snapshotSocket.ts`
- Test: `client/src/api/snapshotSocket.test.ts`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

**Interfaces:**
- Consumes: `Dashboard` from Task 13, `resolveToken` from Task 11, types from Task 11
- Produces: `class SnapshotSocketClient` (connects, reconnects with
  backoff, reports status via callback) and `function App(): JSX.Element`
  — the top of the phase-1 UI; nothing later in this plan consumes it.

This task deliberately does **not** also fetch the initial snapshots over
REST: the WebSocket already sends one snapshot per resource immediately
on connect (Task 9), so a separate parallel REST bootstrap would just
race it for no benefit — the bug flagged in review (a slow REST response
overwriting a fresher WS snapshot) is avoided by not having a second data
source at all. `apiFetch` from Task 11 remains available for future
one-off/debug use, but `App` doesn't call it.

- [ ] **Step 1: Write the failing tests for the reconnecting client**

A fake, injectable `WebSocket` constructor lets this be tested without a
real network connection or a real server.

```ts
// client/src/api/snapshotSocket.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SnapshotSocketClient } from './snapshotSocket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners: Record<string, Array<(event: any) => void>> = {};
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (event: any) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, event: any = {}) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  localStorage.setItem('allay-token', 'tok');
});

describe('SnapshotSocketClient', () => {
  it('connects immediately and reports status transitions', () => {
    const statuses: string[] = [];
    new SnapshotSocketClient({
      baseWsUrl: '',
      onMessage: () => {},
      onStatusChange: (s) => statuses.push(s),
      WebSocketImpl: FakeWebSocket as any,
    });

    expect(statuses).toEqual(['connecting']);
    FakeWebSocket.instances[0].emit('open');
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('parses incoming messages and forwards them to onMessage', () => {
    const messages: unknown[] = [];
    new SnapshotSocketClient({
      baseWsUrl: '',
      onMessage: (m) => messages.push(m),
      WebSocketImpl: FakeWebSocket as any,
    });

    FakeWebSocket.instances[0].emit('message', { data: JSON.stringify({ type: 'snapshot', resource: 'hook', snapshot: { data: null, lastSuccessAt: null, lastError: null, isStale: true } }) });
    expect(messages).toHaveLength(1);
  });

  it('reconnects with an increasing delay after an unexpected close, and resets it on the next open', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    new SnapshotSocketClient({
      baseWsUrl: '',
      onMessage: () => {},
      onStatusChange: (s) => statuses.push(s),
      WebSocketImpl: FakeWebSocket as any,
      reconnectDelayMs: 1000,
    });

    FakeWebSocket.instances[0].emit('open');
    FakeWebSocket.instances[0].emit('close'); // unexpected close
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(1); // reconnect not attempted yet

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2); // first reconnect attempt

    FakeWebSocket.instances[1].emit('close'); // fails again immediately
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2); // not yet — delay doubled to 2000
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2].emit('open'); // recovers, delay resets
    FakeWebSocket.instances[2].emit('close');
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4); // back to the base 1000ms delay

    vi.useRealTimers();
  });

  it('close() stops any pending reconnect and reports closed', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const client = new SnapshotSocketClient({
      baseWsUrl: '',
      onMessage: () => {},
      onStatusChange: (s) => statuses.push(s),
      WebSocketImpl: FakeWebSocket as any,
      reconnectDelayMs: 1000,
    });

    FakeWebSocket.instances[0].emit('close');
    client.close();
    vi.advanceTimersByTime(10_000);

    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect attempted after close()
    expect(statuses.at(-1)).toBe('closed');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './snapshotSocket'`

- [ ] **Step 3: Implement**

```ts
// client/src/api/snapshotSocket.ts
import { resolveToken } from './client';
import type { SnapshotMessage } from './types';

export type SnapshotSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SnapshotSocketOptions {
  baseWsUrl: string;
  onMessage: (msg: SnapshotMessage) => void;
  onStatusChange?: (status: SnapshotSocketStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class SnapshotSocketClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private currentDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(private options: SnapshotSocketOptions) {
    this.currentDelay = options.reconnectDelayMs ?? 1000;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.connect();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.options.onStatusChange?.('closed');
  }

  private connect(): void {
    this.options.onStatusChange?.('connecting');
    const token = resolveToken() ?? '';
    const ws = new this.WebSocketImpl(`${this.options.baseWsUrl}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.currentDelay = this.options.reconnectDelayMs ?? 1000;
      this.options.onStatusChange?.('open');
    });

    ws.addEventListener('message', (event: any) => {
      this.options.onMessage(JSON.parse(event.data as string) as SnapshotMessage);
    });

    ws.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.options.onStatusChange?.('reconnecting');
      const delay = this.currentDelay;
      const maxDelay = this.options.maxReconnectDelayMs ?? 30_000;
      this.currentDelay = Math.min(this.currentDelay * 2, maxDelay);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 5: Wire `App` and `main.tsx`**

```tsx
// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
```

```tsx
// client/src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { SnapshotSocketClient, type SnapshotSocketStatus } from './api/snapshotSocket';
import type { PollSnapshot, HookStatus, MailMessage, RigSummary, BeadSummary, SnapshotMessage } from './api/types';

export function App() {
  const [hook, setHook] = useState<PollSnapshot<HookStatus> | null>(null);
  const [mail, setMail] = useState<PollSnapshot<MailMessage[]> | null>(null);
  const [rigs, setRigs] = useState<PollSnapshot<RigSummary[]> | null>(null);
  const [beads, setBeads] = useState<PollSnapshot<BeadSummary[]> | null>(null);
  const [status, setStatus] = useState<SnapshotSocketStatus>('connecting');
  const clientRef = useRef<SnapshotSocketClient | null>(null);

  useEffect(() => {
    const client = new SnapshotSocketClient({
      baseWsUrl: '', // same-origin, proxied by Vite in dev
      onStatusChange: setStatus,
      onMessage: (msg: SnapshotMessage) => {
        if (msg.resource === 'hook') setHook(msg.snapshot);
        if (msg.resource === 'mail') setMail(msg.snapshot);
        if (msg.resource === 'rigs') setRigs(msg.snapshot);
        if (msg.resource === 'beads') setBeads(msg.snapshot);
      },
    });
    clientRef.current = client;
    return () => client.close();
  }, []);

  return (
    <main>
      <h1>Allay</h1>
      {status !== 'open' && <p role="alert">{status === 'reconnecting' ? 'Reconnecting to server…' : 'Connecting…'}</p>}
      <Dashboard hook={hook} mail={mail} rigs={rigs} beads={beads} />
    </main>
  );
}
```

The `SnapshotMessage` discriminated union means each `msg.resource ===
'hook'` check above narrows `msg.snapshot` to exactly
`PollSnapshot<HookStatus>` — no `as` casts needed.

- [ ] **Step 6: Final manual smoke test**

With the server from Task 10 running (`npm run dev --workspace server`), in another
terminal:

```bash
npm run dev --workspace client
```

Open the printed Vite URL with `?token=<token from the server's startup log>`
appended once. Confirm:
- The Hook/Mail/Rigs/Beads sections populate within a few seconds, each
  showing an "Updated HH:MM:SS" line.
- The values match `gt hook --json` / `gt mail inbox --json` /
  `gt rig list --json` / `bd list --status=open --json` run directly in
  a terminal against this same town.
- Stopping the server causes the "Reconnecting to server…" banner to
  appear while the dashboard keeps showing the last-known data.
- Restarting the server causes the banner to clear and fresh data to
  arrive within a few seconds, without a page reload.

- [ ] **Step 7: Commit**

```bash
git add client/src/api/snapshotSocket.ts client/src/api/snapshotSocket.test.ts client/src/main.tsx client/src/App.tsx
git commit -m "feat: wire App to the server via a reconnecting WebSocket client"
```

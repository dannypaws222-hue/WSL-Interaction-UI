# Allay Agent Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a town-wide agent roster (5th poller resource, same
snapshot/WS pattern as hook/mail/rigs/beads) and an on-demand tmux
pane-capture view, so the dashboard shows who's running and what
they're doing right now.

**Architecture:** Two new server-side CLI wrappers (`getAgents()` parses
`gt status --json`'s flattened agent list; `capturePane()` discovers
Gas Town's dynamic tmux socket via that same command, then shells to
`tmux capture-pane`), wired into the existing poller/REST/WS
infrastructure plus one new on-demand REST route. Two new client
components (a roster table, a polling detail panel) wired into `App`.

**Tech Stack:** Same as Phase 1 — TypeScript, Node.js, Express, `ws`,
React, Vite, Vitest, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-09-14-allay-agent-visibility-design.md`

## Global Constraints

- Server source uses NodeNext — explicit `.js` extensions on relative
  imports.
- All CLI invocation goes through `safeExec` (fixed command, validated
  argv array) — this includes `tmux`, not just `gt`/`bd`.
- Gas Town's tmux socket is **dynamic per town** (e.g. `gt-f96c12`) —
  verified live during design. `capturePane` must discover it at call
  time via `gt status --json`'s `tmux.socket_path` field; never
  hardcode a socket name.
- The pane route validates `:session` against the **current cached
  agents snapshot** before calling `tmux` — an unknown session is a 404,
  never passed to `capturePane`.
- Pane text is rendered as plain React text content on the client —
  never `dangerouslySetInnerHTML`.
- The new REST routes sit behind the same `hostMiddleware` +
  `tokenMiddleware` as every existing route.
- Contract tests (`*.contract.test.ts`) run against the real `gt`/`tmux`
  binaries, gated behind `ALLAY_LIVE_TESTS=1` so default `npm test`
  stays hermetic — this town's own live tmux session was used to verify
  the mechanism during design, so these tests are runnable for real.

---

### Task 1: CLI Adapter — `getAgents()`

**Files:**
- Modify: `server/src/cli-adapter/types.ts` (add `AgentSummary`)
- Modify: `server/src/cli-adapter/gt.ts` (add `getAgents()`)
- Modify: `server/src/cli-adapter/gt.test.ts` (add tests)
- Modify: `server/src/cli-adapter/gt.contract.test.ts` (add live test)

**Interfaces:**
- Consumes: `safeExec` from `./exec.js` (existing)
- Produces: `AgentSummary` type, `getAgents(): Promise<AgentSummary[]>` — used by Tasks 3 and 4.

Real `gt status --json` shape (verified against the live binary; this
plan only uses the `agents`, `rigs[].agents`, and `tmux.socket_path`
fields — other fields like `overseer`/`dnd`/`daemon` are ignored):

```json
{
  "agents": [
    { "name": "mayor", "address": "mayor/", "session": "hq-mayor", "role": "coordinator", "running": true, "acp": false, "has_work": false, "state": "idle", "unread_mail": 0, "agent_alias": "claude", "agent_info": "claude" }
  ],
  "rigs": [
    {
      "name": "allay",
      "agents": [
        { "name": "witness", "address": "allay/witness", "session": "al-witness", "role": "witness", "running": true, "acp": false, "has_work": false, "state": "idle", "unread_mail": 0, "agent_alias": "codex", "agent_info": "codex" }
      ]
    }
  ],
  "tmux": { "socket": "gt-f96c12", "socket_path": "/tmp/tmux-1000/gt-f96c12" }
}
```

- [ ] **Step 1: Add the `AgentSummary` type**

```ts
// server/src/cli-adapter/types.ts — append to the existing file
export interface AgentSummary {
  name: string;
  address: string;
  session: string;
  role: string;
  rig: string | null;
  running: boolean;
  state: string;
  hasWork: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// server/src/cli-adapter/gt.test.ts — add to the existing describe('gt.ts', ...) block
it('getAgents() flattens town-level and rig-level agents, tagging rig', async () => {
  vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
    agents: [
      { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', running: true, state: 'idle', has_work: false },
    ],
    rigs: [
      {
        name: 'allay',
        agents: [
          { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', running: true, state: 'idle', has_work: false },
        ],
      },
    ],
    tmux: { socket: 'gt-f96c12', socket_path: '/tmp/tmux-1000/gt-f96c12' },
  }));

  const result = await getAgents();
  expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['status', '--json']);
  expect(result).toEqual([
    { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
    { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: false },
  ]);
});

it('getAgents() handles a rig with no agents field gracefully', async () => {
  vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
    agents: [],
    rigs: [{ name: 'empty-rig' }],
    tmux: { socket: 'x', socket_path: '/tmp/x' },
  }));
  await expect(getAgents()).resolves.toEqual([]);
});

it('getAgents() rejects when the CLI returns an unexpected shape', async () => {
  vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ agents: 'not-an-array', rigs: [] }));
  await expect(getAgents()).rejects.toThrow(/unexpected shape/i);
});
```

Also add `getAgents` to the existing `import { getHook, getMailInbox, getRigList } from './gt.js';` line at the top of the test file.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `getAgents is not a function` / `Cannot find export 'getAgents'`

- [ ] **Step 4: Implement**

```ts
// server/src/cli-adapter/gt.ts — add to the existing file
import type { AgentSummary } from './types.js';
// (extend the existing `import type { HookStatus, MailMessage, RigSummary } from './types.js';`
// line to also import AgentSummary, rather than adding a second import line)

interface RawAgent {
  name: string;
  address: string;
  session: string;
  role: string;
  running: boolean;
  state: string;
  has_work: boolean;
}

function toAgentSummary(agent: RawAgent, rig: string | null): AgentSummary {
  return {
    name: agent.name,
    address: agent.address,
    session: agent.session,
    role: agent.role,
    rig,
    running: agent.running,
    state: agent.state,
    hasWork: agent.has_work,
  };
}

function parseAgents(raw: string): AgentSummary[] {
  const value = JSON.parse(raw);
  if (
    typeof value !== 'object' || value === null ||
    !Array.isArray(value.agents) || !Array.isArray(value.rigs)
  ) {
    throw new Error(`gt status --json returned an unexpected shape: ${raw.slice(0, 200)}`);
  }
  const town = (value.agents as RawAgent[]).map((a) => toAgentSummary(a, null));
  const rigAgents = (value.rigs as Array<{ name: string; agents?: RawAgent[] }>).flatMap((rig) =>
    Array.isArray(rig.agents) ? rig.agents.map((a) => toAgentSummary(a, rig.name)) : []
  );
  return [...town, ...rigAgents];
}

export async function getAgents(): Promise<AgentSummary[]> {
  return parseAgents(await safeExec('gt', ['status', '--json']));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 6: Add the live contract test**

```ts
// server/src/cli-adapter/gt.contract.test.ts — add inside the existing liveDescribe block,
// and add `getAgents` to the existing `import { getHook, getMailInbox, getRigList } from './gt.js';` line
it('getAgents() returns a non-empty array including this town\'s mayor, against the real gt CLI', async () => {
  const result = await getAgents();
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBeGreaterThan(0);
  const mayor = result.find((a) => a.role === 'coordinator' || a.address === 'mayor/');
  expect(mayor).toBeDefined();
  for (const agent of result) {
    expect(typeof agent.session).toBe('string');
    expect(typeof agent.name).toBe('string');
  }
});
```

Run once manually to confirm it passes against this town: `ALLAY_LIVE_TESTS=1 npm run test --workspace server -- gt.contract.test.ts`

- [ ] **Step 7: Commit**

```bash
git add server/src/cli-adapter/types.ts server/src/cli-adapter/gt.ts server/src/cli-adapter/gt.test.ts server/src/cli-adapter/gt.contract.test.ts
git commit -m "feat: add getAgents() flattening the town-wide agent roster"
```

---

### Task 2: CLI Adapter — `capturePane()`

**Files:**
- Create: `server/src/cli-adapter/tmux.ts`
- Create: `server/src/cli-adapter/tmux.test.ts`
- Create: `server/src/cli-adapter/tmux.contract.test.ts`

**Interfaces:**
- Consumes: `safeExec` from `./exec.js`, `getAgents` from `./gt.js` (contract test only, to find a real session to capture)
- Produces: `capturePane(session: string, lines?: number): Promise<string>` — used by Task 4.

Verified live during design: Gas Town's tmux socket path is dynamic
(this town's is `/tmp/tmux-1000/gt-f96c12`), discovered via
`gt status --json`'s `tmux.socket_path`. `tmux -S <full-path>
capture-pane -t <session> -p -S -<lines>` (no `-e`, so no ANSI escape
codes) was confirmed to return real, readable pane text for both this
session's own tmux pane and a different agent's (`al-witness`).

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/cli-adapter/tmux.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as execModule from './exec.js';
import { capturePane } from './tmux.js';

describe('capturePane', () => {
  beforeEach(() => {
    vi.spyOn(execModule, 'safeExec').mockReset();
  });

  it('discovers the tmux socket via gt status --json, then captures the pane', async () => {
    vi.mocked(execModule.safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket: 'gt-abc', socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('line one\nline two\n');

    const result = await capturePane('hq-mayor', 20);

    expect(execModule.safeExec).toHaveBeenNthCalledWith(1, 'gt', ['status', '--json']);
    expect(execModule.safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-20',
    ]);
    expect(result).toBe('line one\nline two\n');
  });

  it('defaults to 50 lines when not specified', async () => {
    vi.mocked(execModule.safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('');

    await capturePane('hq-mayor');

    expect(execModule.safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-50',
    ]);
  });

  it('throws when gt status --json is missing tmux.socket_path', async () => {
    vi.mocked(execModule.safeExec).mockResolvedValueOnce(JSON.stringify({ tmux: {} }));
    await expect(capturePane('hq-mayor')).rejects.toThrow(/socket_path/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `Cannot find module './tmux.js'`

- [ ] **Step 3: Implement**

```ts
// server/src/cli-adapter/tmux.ts
import { safeExec } from './exec.js';

async function getTmuxSocketPath(): Promise<string> {
  const raw = JSON.parse(await safeExec('gt', ['status', '--json']));
  const socketPath = raw?.tmux?.socket_path;
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('gt status --json is missing tmux.socket_path');
  }
  return socketPath;
}

export async function capturePane(session: string, lines = 50): Promise<string> {
  const socketPath = await getTmuxSocketPath();
  return safeExec('tmux', ['-S', socketPath, 'capture-pane', '-t', session, '-p', '-S', `-${lines}`]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Add the live contract test**

```ts
// server/src/cli-adapter/tmux.contract.test.ts
import { describe, it, expect } from 'vitest';
import { getAgents } from './gt.js';
import { capturePane } from './tmux.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('capturePane (live tmux contract)', () => {
  it('captures real pane text for a real running agent session', async () => {
    const agents = await getAgents();
    const running = agents.find((a) => a.running);
    expect(running).toBeDefined();

    const pane = await capturePane(running!.session, 10);
    expect(typeof pane).toBe('string');
  });
});
```

Run once manually: `ALLAY_LIVE_TESTS=1 npm run test --workspace server -- tmux.contract.test.ts`

- [ ] **Step 6: Commit**

```bash
git add server/src/cli-adapter/tmux.ts server/src/cli-adapter/tmux.test.ts server/src/cli-adapter/tmux.contract.test.ts
git commit -m "feat: add capturePane() with dynamic tmux socket discovery"
```

---

### Task 3: Server Wiring — `agents` as a 5th snapshot resource

**Files:**
- Modify: `server/src/api/routes.ts` (`PollerMap` gains `agents`, add `GET /status/agents`)
- Modify: `server/src/api/routes.test.ts`
- Modify: `server/src/api/ws.ts` (`SnapshotMessage` union gains an `agents` variant, wire it)
- Modify: `server/src/api/ws.test.ts`
- Modify: `server/src/app.test.ts` (its `buildPollers()` helper needs an `agents` field)
- Modify: `server/src/index.ts` (add the `agents` poller)

**Interfaces:**
- Consumes: `getAgents`/`AgentSummary` from Task 1, `Poller`/`Observable`/`PollSnapshot` from the existing `poll-scheduler`
- Produces: `PollerMap.agents: Observable<AgentSummary[]>`, `GET /api/status/agents`, `SnapshotMessage`'s `agents` variant — used by Task 4 (for the allowlist check) and the client (Tasks 5-8).

This task modifies three existing test files. Their current content is
shown below exactly, so the edits are unambiguous — read each file
first to confirm it still matches before editing (if it doesn't,
something changed; stop and ask).

**`server/src/api/routes.test.ts`** currently (in full):

```ts
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

Edit it to: add `AgentSummary` to the type import from
`'../cli-adapter/types.js'`; add an `agents` field to `buildPollers()`
using a roster that **includes a `session: 'hq-mayor'` entry** (Task 4's
own tests, and its addition to this same file, depend on `buildPollers()`
containing a known `hq-mayor` session — don't use an empty array here);
and add one new test:

```ts
// add to the type import:
import type { HookStatus, MailMessage, RigSummary, BeadSummary, AgentSummary } from '../cli-adapter/types.js';

// add to buildPollers()'s returned object:
agents: fakeSource<AgentSummary[]>({ data: [{ name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false }], lastSuccessAt: 1, lastError: null, isStale: false }),

// add inside describe('createApiRouter', ...), alongside the existing tests:
it('exposes an agents route', async () => {
  const res = await request(buildApp()).get('/api/status/agents').set('x-allay-token', token);
  expect(res.status).toBe(200);
  expect(res.body.data[0].session).toBe('hq-mayor');
});
```

**`server/src/api/ws.test.ts`**: add `agents` to `buildPollers()`
(mirroring the other three, using `fakeObservable<AgentSummary[]>`),
add `AgentSummary` to its existing type import from
`'../cli-adapter/types.js'`, and add `agents` to `buildPollers()`'s
return-type annotation the same way `hook`/`mail`/`rigs`/`beads` are
each listed there today (`agents: ReturnType<typeof
fakeObservable<AgentSummary[]>>;`). Then:
- In the "sends all four initial snapshots on connect" test, change
  `nextNMessages(ws, 4)` to `nextNMessages(ws, 5)` and its assertion to
  `expect(new Set(messages.map((m) => m.resource))).toEqual(new Set(['hook', 'mail', 'rigs', 'beads', 'agents']));`
  (also rename the test description to say "all five").
- In "broadcasts an update to a connected client", "broadcasts to two
  simultaneous clients independently", and "unsubscribes from all
  pollers when a client disconnects", change every `nextNMessages(ws,
  4)` (or `wsA`/`wsB` equivalents) to `nextNMessages(ws, 5)` — these
  tests wait for the initial batch before doing their real assertion,
  so they need to know a 5th message is coming or they'll deadlock
  waiting for a count that never arrives.
- Add one new test verifying the 5th resource also broadcasts updates,
  mirroring the existing "broadcasts an update to a connected client"
  test but emitting on `pollers.agents` and asserting
  `update.resource === 'agents'`.

**`server/src/app.test.ts`** currently (in full):

```ts
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

Add an `agents` field to `buildPollers()`, **again including a
`session: 'hq-mayor'` entry** (Task 4 adds a test to this exact file
that requests `/api/agents/hq-mayor/pane` and expects 200 — an empty or
differently-sessioned fixture here would make that a 404 instead):

```ts
agents: fakeSource<import('./cli-adapter/types.js').AgentSummary[]>([{ name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false }]),
```

(This file's `fakeSource` takes raw `data`, not a full snapshot, unlike
`routes.test.ts`'s — match its existing style rather than the other
file's.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — `agents` missing from `PollerMap` (type errors) and the WS test's message-count assertions failing (4 vs 5)

- [ ] **Step 3: Implement**

```ts
// server/src/api/routes.ts — modify
// 1. Extend the type import: `import type { HookStatus, MailMessage, RigSummary, BeadSummary, AgentSummary } from '../cli-adapter/types.js';`
// 2. Extend PollerMap:
export interface PollerMap {
  hook: Observable<HookStatus>;
  mail: Observable<MailMessage[]>;
  rigs: Observable<RigSummary[]>;
  beads: Observable<BeadSummary[]>;
  agents: Observable<AgentSummary[]>;
}
// 3. In createApiRouter, add:
router.get('/status/agents', (_req, res) => res.json(pollers.agents.getSnapshot()));
```

```ts
// server/src/api/ws.ts — modify
// 1. Extend the type import: `import type { HookStatus, MailMessage, RigSummary, BeadSummary, AgentSummary } from '../cli-adapter/types.js';`
// 2. Extend the SnapshotMessage union:
export type SnapshotMessage =
  | { type: 'snapshot'; resource: 'hook'; snapshot: PollSnapshot<HookStatus> }
  | { type: 'snapshot'; resource: 'mail'; snapshot: PollSnapshot<MailMessage[]> }
  | { type: 'snapshot'; resource: 'rigs'; snapshot: PollSnapshot<RigSummary[]> }
  | { type: 'snapshot'; resource: 'beads'; snapshot: PollSnapshot<BeadSummary[]> }
  | { type: 'snapshot'; resource: 'agents'; snapshot: PollSnapshot<AgentSummary[]> };
// 3. In the wss.on('connection', ...) handler, add one more call alongside the existing four:
//    wire('agents');
```

```ts
// server/src/index.ts — modify
// 1. Extend the gt.js import: `import { getHook, getMailInbox, getRigList, getAgents } from './cli-adapter/gt.js';`
// 2. Add to the pollers object:
//    agents: new Poller(getAgents, { intervalMs: 5000 }),
// 3. Add its start() call alongside the other three:
//    pollers.agents.start();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes.ts server/src/api/routes.test.ts server/src/api/ws.ts server/src/api/ws.test.ts server/src/app.test.ts server/src/index.ts
git commit -m "feat: add agents as a 5th polled/broadcast resource"
```

---

### Task 4: Server — on-demand pane route with session allowlist

**Files:**
- Modify: `server/src/api/routes.ts` (accept `capturePane` as a dependency, add `GET /agents/:session/pane`)
- Modify: `server/src/api/routes.test.ts`
- Modify: `server/src/app.ts` (thread the new dependency through `createApp`)
- Modify: `server/src/app.test.ts`
- Modify: `server/src/index.ts` (pass the real `capturePane` in)

**Interfaces:**
- Consumes: `capturePane` from Task 2, `PollerMap.agents` from Task 3
- Produces: `GET /api/agents/:session/pane` returning `{ session: string; pane: string; capturedAt: number }`; updated `createApiRouter(pollers, getToken, capturePane)` and `createApp(pollers, getToken, capturePane)` signatures — used by the client (Task 7).

`capturePane` is passed in as a function parameter (the same
dependency-injection style already used for `getToken`) rather than
imported directly into `routes.ts`, so tests can substitute a fake
without module-mocking.

- [ ] **Step 1: Write the failing tests**

First, two required updates to existing code in `server/src/api/routes.test.ts`:
- Add `vi` to its `import { describe, it, expect } from 'vitest';` line
  (it doesn't import `vi` today, and this task's new tests need
  `vi.fn()`).
- The existing `buildApp()` helper calls `createApiRouter(buildPollers(),
  () => token)` with two arguments. `createApiRouter`'s signature is
  changing (Step 3 below) to require a third, `capturePane`, parameter —
  update `buildApp()` to pass one, e.g.
  `createApiRouter(buildPollers(), () => token, vi.fn())`, so the
  file's three pre-existing tests keep compiling and passing unchanged.

```ts
// server/src/api/routes.test.ts — add (alongside the existing describe('createApiRouter', ...) block)
describe('GET /api/agents/:session/pane', () => {
  const token = 'test-token';

  function buildAppWithPane(capturePane: (session: string, lines?: number) => Promise<string>) {
    const app = express();
    app.use('/api', createApiRouter(buildPollers(), () => token, capturePane));
    return app;
  }

  it('returns pane text for a known agent session', async () => {
    const capturePane = vi.fn().mockResolvedValue('some pane output');
    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/hq-mayor/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(200);
    expect(res.body.session).toBe('hq-mayor');
    expect(res.body.pane).toBe('some pane output');
    expect(capturePane).toHaveBeenCalledWith('hq-mayor');
  });

  it('returns 404 for a session not in the current agents roster (no capturePane call)', async () => {
    const capturePane = vi.fn();
    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/not-a-real-session/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(404);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('returns 401 without a valid token, before checking the session', async () => {
    const capturePane = vi.fn();
    const res = await request(buildAppWithPane(capturePane)).get('/api/agents/hq-mayor/pane');
    expect(res.status).toBe(401);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('returns 502 when capturePane itself fails', async () => {
    const capturePane = vi.fn().mockRejectedValue(new Error('tmux not found'));
    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/hq-mayor/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/tmux not found/);
  });
});
```

(`buildPollers()` already provides an `agents` snapshot containing a
`hq-mayor` session, from Task 3.)

`server/src/app.test.ts` has three existing `createApp(buildPollers(),
() => token)` call sites (one per `it(...)`, shown in Task 3's excerpt
of this file above), each with two arguments. Update all three to pass
a third: `createApp(buildPollers(), () => token, vi.fn())` — and add
`vi` to this file's `import { describe, it, expect } from 'vitest';`
line, since it doesn't import `vi` today either. Then add one new test:

```ts
// server/src/app.test.ts — add, alongside the existing tests:
it('serves the agents pane route through the composed app', async () => {
  const capturePane = vi.fn().mockResolvedValue('pane text');
  const app = createApp(buildPollers(), () => token, capturePane);
  const res = await request(app).get('/api/agents/hq-mayor/pane').set('x-allay-token', token);
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server`
Expected: FAIL — route doesn't exist yet / `createApiRouter`'s third parameter doesn't exist yet

- [ ] **Step 3: Implement**

```ts
// server/src/api/routes.ts — modify createApiRouter's signature and body
export function createApiRouter(
  pollers: PollerMap,
  getToken: () => string,
  capturePane: (session: string, lines?: number) => Promise<string>
): Router {
  const router = Router();
  router.use(tokenMiddleware(getToken));

  router.get('/status/hook', (_req, res) => res.json(pollers.hook.getSnapshot()));
  router.get('/status/mail', (_req, res) => res.json(pollers.mail.getSnapshot()));
  router.get('/status/rigs', (_req, res) => res.json(pollers.rigs.getSnapshot()));
  router.get('/status/beads', (_req, res) => res.json(pollers.beads.getSnapshot()));
  router.get('/status/agents', (_req, res) => res.json(pollers.agents.getSnapshot()));

  router.get('/agents/:session/pane', async (req, res) => {
    const { session } = req.params;
    const roster = pollers.agents.getSnapshot().data ?? [];
    const known = roster.some((agent) => agent.session === session);
    if (!known) {
      res.status(404).json({ error: 'unknown agent session' });
      return;
    }
    try {
      const pane = await capturePane(session);
      res.json({ session, pane, capturedAt: Date.now() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

```ts
// server/src/app.ts — modify
export function createApp(
  pollers: PollerMap,
  getToken: () => string,
  capturePane: (session: string, lines?: number) => Promise<string>
) {
  const app = express();
  app.use(hostMiddleware());
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', createApiRouter(pollers, getToken, capturePane));
  return app;
}
```

```ts
// server/src/index.ts — modify
// 1. Import capturePane: `import { capturePane } from './cli-adapter/tmux.js';`
// 2. Update both call sites to pass it as the third argument:
//    const app = createApp(pollers, () => token, capturePane);
//    (attachSnapshotSocket's signature is unchanged — it doesn't need capturePane)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes.ts server/src/api/routes.test.ts server/src/app.ts server/src/app.test.ts server/src/index.ts
git commit -m "feat: add on-demand pane route with session-allowlist validation"
```

---

### Task 5: Client — types

**Files:**
- Modify: `client/src/api/types.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `AgentSummary`, `PaneResponse`, extended `SnapshotMessage` union — used by Tasks 6, 7, 8.

- [ ] **Step 1: Add the types**

```ts
// client/src/api/types.ts — append/modify
export interface AgentSummary {
  name: string;
  address: string;
  session: string;
  role: string;
  rig: string | null;
  running: boolean;
  state: string;
  hasWork: boolean;
}

export interface PaneResponse {
  session: string;
  pane: string;
  capturedAt: number;
}

// Replace the existing SnapshotMessage union with:
export type SnapshotMessage =
  | { type: 'snapshot'; resource: 'hook'; snapshot: PollSnapshot<HookStatus> }
  | { type: 'snapshot'; resource: 'mail'; snapshot: PollSnapshot<MailMessage[]> }
  | { type: 'snapshot'; resource: 'rigs'; snapshot: PollSnapshot<RigSummary[]> }
  | { type: 'snapshot'; resource: 'beads'; snapshot: PollSnapshot<BeadSummary[]> }
  | { type: 'snapshot'; resource: 'agents'; snapshot: PollSnapshot<AgentSummary[]> };
```

There is no test for this task — it's a pure type addition; correctness
is enforced by the type-checker in Tasks 6-8.

- [ ] **Step 2: Verify the build still typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (no consumers yet, so nothing should break)

- [ ] **Step 3: Commit**

```bash
git add client/src/api/types.ts
git commit -m "feat: add AgentSummary/PaneResponse types and extend SnapshotMessage"
```

---

### Task 6: Client — `AgentsRoster` component

**Files:**
- Create: `client/src/components/AgentsRoster.tsx`
- Create: `client/src/components/AgentsRoster.test.tsx`

**Interfaces:**
- Consumes: `SnapshotCard` (existing), `PollSnapshot`/`AgentSummary` from Task 5
- Produces: `function AgentsRoster(props: { agents: PollSnapshot<AgentSummary[]> | null; selectedSession: string | null; onSelect: (session: string) => void }): JSX.Element` — used by Task 8.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/AgentsRoster.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentsRoster } from './AgentsRoster';
import type { PollSnapshot, AgentSummary } from '../api/types';

function sampleSnapshot(): PollSnapshot<AgentSummary[]> {
  return {
    data: [
      { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
      { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: true },
    ],
    lastSuccessAt: 1,
    lastError: null,
    isStale: false,
  };
}

describe('AgentsRoster', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a row per agent with name, role, rig, and state', () => {
    render(<AgentsRoster agents={sampleSnapshot()} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    expect(screen.getByText('town')).toBeInTheDocument();
    expect(screen.getByText('allay')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('calls onSelect with the session when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<AgentsRoster agents={sampleSnapshot()} selectedSession={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('mayor'));
    expect(onSelect).toHaveBeenCalledWith('hq-mayor');
  });

  it('shows loading state when there is no snapshot yet', () => {
    render(<AgentsRoster agents={null} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state when the roster has never loaded and a poll failed', () => {
    render(
      <AgentsRoster
        agents={{ data: null, lastSuccessAt: null, lastError: 'gt not found', isStale: true }}
        selectedSession={null}
        onSelect={() => {}}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('gt not found');
  });

  it('shows a stale warning alongside existing data when the latest poll failed', () => {
    const stale = sampleSnapshot();
    stale.isStale = true;
    stale.lastError = 'boom';
    render(<AgentsRoster agents={stale} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByText('mayor')).toBeInTheDocument();
  });
});
```

(The loading/error/stale states here are `SnapshotCard`'s own
existing, already-tested logic — these two extra tests just confirm
`AgentsRoster` wires its `snapshot` prop through to `SnapshotCard`
correctly, per the spec's "roster rendering (loading/data/error/stale)"
testing requirement; they intentionally don't re-derive
`SnapshotCard`'s internal branching.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './AgentsRoster'`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/AgentsRoster.tsx
import { SnapshotCard } from './SnapshotCard';
import type { PollSnapshot, AgentSummary } from '../api/types';

export interface AgentsRosterProps {
  agents: PollSnapshot<AgentSummary[]> | null;
  selectedSession: string | null;
  onSelect: (session: string) => void;
}

function stateLabel(agent: AgentSummary): string {
  if (!agent.running) return 'stopped';
  return agent.hasWork ? 'working' : agent.state;
}

export function AgentsRoster({ agents, selectedSession, onSelect }: AgentsRosterProps) {
  return (
    <SnapshotCard title="Agents" snapshot={agents} renderData={(data) => (
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>Rig</th><th>State</th></tr>
        </thead>
        <tbody>
          {data.map((agent) => (
            <tr key={agent.session}>
              <td>
                <button
                  onClick={() => onSelect(agent.session)}
                  aria-pressed={agent.session === selectedSession}
                >
                  {agent.name}
                </button>
              </td>
              <td>{agent.role}</td>
              <td>{agent.rig ?? 'town'}</td>
              <td>{stateLabel(agent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )} />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AgentsRoster.tsx client/src/components/AgentsRoster.test.tsx
git commit -m "feat: add AgentsRoster table component"
```

---

### Task 7: Client — `AgentPanel` component

**Files:**
- Create: `client/src/components/AgentPanel.tsx`
- Create: `client/src/components/AgentPanel.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `../api/client`, `PaneResponse` from Task 5
- Produces: `function AgentPanel(props: { session: string; onClose: () => void; pollIntervalMs?: number }): JSX.Element` — used by Task 8. Polls while mounted; the parent (Task 8) is responsible for mounting/unmounting it based on selection.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/AgentPanel.test.tsx
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentPanel } from './AgentPanel';
import * as apiClient from '../api/client';

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the pane on mount and renders it as plain text', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'hello from mayor', capturedAt: 1 });
    render(<AgentPanel session="hq-mayor" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('hello from mayor')).toBeInTheDocument());
    expect(apiClient.apiFetch).toHaveBeenCalledWith('/api/agents/hq-mayor/pane');
  });

  it('renders pane content containing HTML-like text as plain text, not markup', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: '<script>alert(1)</script>', capturedAt: 1 });
    const { container } = render(<AgentPanel session="hq-mayor" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument());
    expect(container.querySelector('script')).toBeNull();
  });

  it('polls again after the interval elapses', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'v1', capturedAt: 1 });
    render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchPane).toHaveBeenCalledTimes(2);
  });

  it('shows an error message when the fetch fails, without throwing', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('502'));
    render(<AgentPanel session="hq-mayor" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('502'));
  });

  it('stops polling once unmounted', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'v1', capturedAt: 1 });
    const { unmount } = render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchPane).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace client`
Expected: FAIL — `Cannot find module './AgentPanel'`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/AgentPanel.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import type { PaneResponse } from '../api/types';

export interface AgentPanelProps {
  session: string;
  onClose: () => void;
  pollIntervalMs?: number;
}

export function AgentPanel({ session, onClose, pollIntervalMs = 3000 }: AgentPanelProps) {
  const [pane, setPane] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPane() {
      try {
        const result = await apiFetch<PaneResponse>(`/api/agents/${encodeURIComponent(session)}/pane`);
        if (!cancelled) {
          setPane(result.pane);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    fetchPane();
    const timer = setInterval(fetchPane, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, pollIntervalMs]);

  return (
    <section aria-label={`${session} pane`}>
      <h2>{session}</h2>
      <button onClick={onClose}>Close</button>
      {error && <p role="alert">{error}</p>}
      <pre>{pane ?? 'Loading…'}</pre>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AgentPanel.tsx client/src/components/AgentPanel.test.tsx
git commit -m "feat: add AgentPanel with polling and plain-text pane rendering"
```

---

### Task 8: Client — wire `App`, manual smoke test

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/App.test.tsx`

**Interfaces:**
- Consumes: `AgentsRoster` (Task 6), `AgentPanel` (Task 7), extended `SnapshotMessage` (Task 5)
- Produces: nothing consumed further — top of this increment.

- [ ] **Step 1: Write the failing test**

The current `App.test.tsx` only covers the no-token state — it never
constructs a real `SnapshotSocketClient` (App checks for a token before
connecting) and has no existing pattern for simulating incoming
messages. Add one: mock the `./api/snapshotSocket` module so the test
can capture the options `App` passes to `SnapshotSocketClient` (in
particular `onMessage`) and invoke them directly, and mock `apiFetch`
(the same way `AgentPanel.test.tsx` does) so opening a panel doesn't
attempt a real network call.

```tsx
// client/src/App.test.tsx — replace the file's full contents with:
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { App } from './App';
import * as apiClient from './api/client';
import type { SnapshotSocketOptions } from './api/snapshotSocket';

let capturedOptions: SnapshotSocketOptions | null = null;

vi.mock('./api/snapshotSocket', () => ({
  SnapshotSocketClient: vi.fn().mockImplementation((options: SnapshotSocketOptions) => {
    capturedOptions = options;
    return { close: vi.fn() };
  }),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedOptions = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a distinct message instead of connecting when no auth token is found', () => {
    // jsdom's default location (http://localhost/) has no ?token=, and
    // localStorage was just cleared, so resolveToken() returns null.
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/no auth token found/i);
    expect(screen.queryByText(/reconnecting to server/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting…/i)).not.toBeInTheDocument();
  });

  it('renders the agents roster once an agents snapshot arrives, and opens a panel on selection', () => {
    localStorage.setItem('allay-token', 'tok');
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'test pane output', capturedAt: 1 });

    render(<App />);
    expect(capturedOptions).not.toBeNull();

    // Calling onMessage directly (not through a simulated DOM event)
    // schedules a React state update outside React's own event handling,
    // so it must be wrapped in act() or the assertion below can run
    // before the re-render commits.
    act(() => {
      capturedOptions!.onMessage({
        type: 'snapshot',
        resource: 'agents',
        snapshot: {
          data: [{ name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false }],
          lastSuccessAt: 1,
          lastError: null,
          isStale: false,
        },
      });
    });

    expect(screen.getByText('mayor')).toBeInTheDocument();

    fireEvent.click(screen.getByText('mayor'));
    expect(screen.getByRole('region', { name: 'hq-mayor pane' })).toBeInTheDocument();
  });

  it('resets pane state when switching from one agent to another', async () => {
    localStorage.setItem('allay-token', 'tok');
    vi.spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ session: 'hq-mayor', pane: 'mayor output', capturedAt: 1 })
      .mockResolvedValueOnce({ session: 'al-witness', pane: 'witness output', capturedAt: 2 });

    render(<App />);
    act(() => {
      capturedOptions!.onMessage({
        type: 'snapshot',
        resource: 'agents',
        snapshot: {
          data: [
            { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
            { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: false },
          ],
          lastSuccessAt: 1,
          lastError: null,
          isStale: false,
        },
      });
    });

    fireEvent.click(screen.getByText('mayor'));
    await screen.findByText('mayor output');

    fireEvent.click(screen.getByText('witness'));
    // The new panel starts from "Loading…" (a fresh mount), never
    // showing the previous agent's leftover output even momentarily.
    expect(screen.queryByText('mayor output')).not.toBeInTheDocument();
    await screen.findByText('witness output');
  });
});
```

(A `<section aria-label="...">` has implicit ARIA role `region` when it
has an accessible name, which is why `AgentPanel`'s section — added in
Task 7 — is queryable via `getByRole('region', { name: ... })`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace client`
Expected: FAIL — `AgentsRoster`/panel not rendered yet

- [ ] **Step 3: Implement**

```tsx
// client/src/App.tsx — modify
// 1. Add imports:
import { AgentsRoster } from './components/AgentsRoster';
import { AgentPanel } from './components/AgentPanel';
import type { AgentSummary } from './api/types'; // add to the existing type import line

// 2. Add state (alongside the existing hook/mail/rigs/beads state):
const [agents, setAgents] = useState<PollSnapshot<AgentSummary[]> | null>(null);
const [selectedSession, setSelectedSession] = useState<string | null>(null);

// 3. In the onMessage handler's resource checks, add:
if (msg.resource === 'agents') setAgents(msg.snapshot);

// 4. In the rendered JSX, after <Dashboard ... />, add:
<AgentsRoster agents={agents} selectedSession={selectedSession} onSelect={setSelectedSession} />
{selectedSession && (
  <AgentPanel key={selectedSession} session={selectedSession} onClose={() => setSelectedSession(null)} />
)}
```

The `key={selectedSession}` is required, not decorative: without it,
switching from one agent to another re-renders the *same* `AgentPanel`
instance with a new `session` prop, but its internal `pane`/`error`
state (Task 7) isn't reset by a prop change — the previous agent's
output or error would stay on screen under the new agent's heading
until the next successful fetch overwrites it. Keying by `session`
forces React to unmount the old panel and mount a fresh one (with fresh
`pane`/`error` state) whenever the selection changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace client`
Expected: PASS

- [ ] **Step 4b: Full typecheck across both workspaces**

`vitest run` does not typecheck — Phase 1 shipped more than one
build-blocking type error that only `tsc` caught, precisely because
this step was skipped along the way. Run the root aggregate script
added at the end of Phase 1:

Run: `npm run typecheck` (from the repo root)
Expected: PASS, zero errors, across both `server` and `client`

- [ ] **Step 5: Manual smoke test**

With the server running (`npm run dev --workspace server`) and the
client running (`npm run dev --workspace client`), open the client with
`?token=...` as established in Phase 1. Confirm:
- The Agents section populates with this town's real roster (mayor,
  deacon, and this rig's witness/refinery/polecats) within a few
  seconds.
- Clicking an agent's name opens its detail panel and shows real,
  readable terminal output within a few seconds — compare it by hand
  against running `tmux -S $(gt status --json | python3 -c "import
  json,sys;print(json.load(sys.stdin)['tmux']['socket_path'])")
  capture-pane -t <session> -p` directly in a terminal for the same
  session.
- Clicking a different agent switches the panel to that agent's pane.
- Closing the panel stops it from polling (no further `/pane` requests
  in the Network tab / server logs for that session).

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: wire AgentsRoster and AgentPanel into App"
```

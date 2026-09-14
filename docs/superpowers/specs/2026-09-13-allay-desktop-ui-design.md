# Allay: Unified Gas Town Interface — Design

Date: 2026-09-13
Status: Approved for planning

## Summary

Allay is a local web app for interacting with Gas Town (`gt`). It gives the
Overseer a single, polished surface — in the spirit of the Claude Code and
Codex UIs — to:

1. Chat live with the Mayor agent.
2. Monitor town state: hooks, mail, rigs/agents, and the bead/issue queue.

It runs as a local server (Node.js/TypeScript) with a browser-based React
frontend. It does not replace `gt`/`bd` — it wraps them.

## Goals / Non-goals

**Goals**
- Live, streaming chat with Mayor, rendered like a modern coding-agent chat UI
  (markdown, tool-call blocks).
- At-a-glance monitoring of hook status, mail, rig/agent health, and bead queue.
- Secondary, explicitly-async view of other agents (deacon, witness, refinery,
  polecats) via nudge + mail inbox.
- Safe to run against a live, in-use Gas Town town without disrupting it.

**Non-goals (v1)**
- Not a general-purpose `gt`/`bd` admin UI (no rig creation, no bead editing
  forms beyond what's needed to read state).
- Not a replacement for the Mayor's own tmux session — Allay is a second,
  independent way to reach Mayor, not a takeover of the primary one.
- No multi-user / remote access. Single local user, loopback only.
- No true bidirectional threaded chat with non-Mayor agents (no reply
  correlation exists in `gt` today — see Open Question below).

## Open Question — must be resolved by a spike before full build

It is unknown whether `gt mayor acp` starts an independent Mayor agent
identity, or otherwise conflicts/interacts with the already-running tmux
Mayor session. This affects:

- Whether Allay's chat and the tmux Mayor can safely run concurrently.
- Whether hooked work, escalations, or bead mutations made via one are
  visible/consistent with the other.
- Whether Allay should warn or block if a tmux Mayor session is already
  mid-task.

**Before any other implementation work**, run a throwaway spike: start
`gt mayor acp`, drive a trivial prompt through it via a hand-written script,
observe what identity/session it registers as (`gt agents`, `gt mayor
status`), and confirm it does not corrupt or race the live Mayor's hook/mail
state. Record findings in this doc (append a "Spike Results" section) before
proceeding to the implementation plan.

## Architecture

```
Browser (React/Vite)
   │  WebSocket (chat + monitor push) + REST (initial loads)
   ▼
Node.js/TypeScript server (Express + ws), loopback-only
   ├── api/            REST: wraps `gt status/hook/mail/rig --json`,
   │                   `bd list/show --json`
   ├── acp-bridge/      Owns one `gt mayor acp` child process; real ACP
   │                   client (see below); streams to browser over WS
   ├── nudge-bridge/    Sends via `gt nudge <target> -m`; polls
   │                   `gt mail inbox --json` for that target's inbox
   ├── poll-scheduler/  Single scheduler, one in-flight call per resource,
   │                   caches last snapshot + last-success timestamp
   └── cli-adapter/     execFile wrapper: fixed argv arrays, timeouts,
                        output size caps, typed response parsing/validation
```

### Frontend

- Sidebar: **Mayor** tab (primary, pinned) + **Agents** menu (rigs/agents,
  opens secondary async views).
- Main pane, per tab:
  - **ChatView** (Mayor): streamed markdown responses, distinct rendering for
    tool-call/tool-result blocks, input box, connection-state indicator
    (connected / reconnecting / error).
  - **ActivityView** (other agents): a flat, timestamped feed combining sent
    nudges and inbox messages for that agent — explicitly not a threaded
    conversation, since `gt` has no request/reply correlation today.
  - **MonitorView**: cards/tables for hook status, mail inbox summary,
    rig/agent list with health, and bead/work queue — populated from the
    poll-scheduler's cached snapshots, pushed to the client over WS on change.

### ACP bridge

Implemented as a real ACP client, not a raw stdio pipe:
- Protocol/capability negotiation on session start (pinned protocol version).
- Session lifecycle: create, prompt, cancel.
- Permission-request handling: any permission prompt from Mayor surfaces in
  the UI for the Overseer to approve/deny, not auto-approved.
- Prefer an existing ACP client library (e.g. `@zed-industries/agent-client-
  protocol` if it fits) over hand-rolled JSON-RPC framing.
- One long-lived `gt mayor acp` child per server process. If it crashes,
  the server restarts it and surfaces a "reconnecting" state — it does
  **not** automatically replay the last prompt (side effects may have
  already occurred; the Overseer re-sends if needed).

### Nudge/Activity bridge

- Sending a message: `gt nudge <target> -m "<text>" --mode=wait-idle`
  (server default; no `--force`, respects DND).
- Receiving: poll scheduler polls `gt mail inbox --json` for entries
  addressed to/from that target on a fixed interval; new entries appended
  to the activity feed.
- No correlation between a sent nudge and a specific inbox reply — the UI
  must not imply one exists.

### Security

- Server binds to `127.0.0.1` only, never `0.0.0.0`.
- A local auth token (generated on first run, stored in a local file) is
  required on all REST calls and the WS upgrade.
- WS upgrade validates `Origin`/`Host` against the expected local origin.
- All CLI invocation goes through `cli-adapter` using `execFile` with a
  fixed command and a validated argv array — never shell string
  interpolation.
- Every CLI call has a timeout and a capped output size.
- Agent-generated content (Mayor chat output, mail bodies) is rendered as
  sanitized markdown — no raw HTML execution.

### Polling model

- One `poll-scheduler` per resource type (hook, mail, rig list, bead queue).
- At most one in-flight CLI call per resource; a poll due while one is
  in-flight is skipped, not queued.
- Cached snapshot + last-success timestamp always available to serve
  reads even if the latest poll failed.
- Read polls retry with backoff on failure. Mutating calls (nudge, any
  future write) are never auto-retried.

### Error handling

- CLI call fails → cached snapshot stays displayed, marked stale, with the
  error and last-success time shown; backoff retry continues in background.
- ACP child process crash → server restarts it, chat UI shows
  "reconnecting", history preserved client-side, no auto-replay of prompts.
- Malformed/unexpected CLI JSON → logged server-side with the raw output
  (capped), client sees a generic "couldn't read town state" error for that
  resource only — other resources keep working.

## Testing

- **Contract tests**: run real `gt --json` / `bd --json` commands (against
  a disposable/test town where possible) and validate the adapter's parsing
  against actual output — not mocks alone — to catch CLI schema drift.
- **Server unit tests**: `cli-adapter`, `poll-scheduler`, and `nudge-bridge`
  logic with `child_process` mocked, covering timeout/error/backoff paths.
- **ACP bridge tests**: exercised primarily through the spike and, once
  built, a scripted fake-ACP-server test double for negotiation/cancel/
  permission-request flows.
- **Frontend tests**: Vitest + React Testing Library for ChatView,
  ActivityView, and MonitorView rendering, including error/stale states.
- **Manual smoke test**: run Allay against this live Gas Town town,
  exercise a Mayor chat round-trip and confirm monitoring views match
  `gt status` / `bd list` output.

## Rollout

1. Spike: resolve the Mayor-process open question (see above).
2. `cli-adapter` + `poll-scheduler` + MonitorView (no chat yet) — this alone
   is independently useful and lower-risk.
3. ACP bridge + ChatView (Mayor tab).
4. Nudge-bridge + ActivityView (Agents menu).
5. Security hardening pass (auth token, Origin checks) before this is ever
   exposed beyond `localhost` loopback use.

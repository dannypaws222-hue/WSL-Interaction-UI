# Allay: Agent Visibility — Design

Date: 2026-09-14
Status: Approved for planning

## Summary

Extends the Allay monitoring dashboard (Phase 1) with a read-only view of
every agent in the town — who exists, what role they play, whether
they're running/idle/working, and (on demand) a recent snapshot of their
terminal output. This is the "viewing working agents" half of the
original design's out-of-scope items; the other half (chatting with
Mayor, via an ACP bridge) remains explicitly out of scope — the Phase 1
spike into `gt mayor acp` came back Inconclusive (this town's default
agent isn't ACP-compatible), and nothing here depends on it.

## Goals / Non-goals

**Goals**
- A town-wide agent roster: mayor, deacon, and every rig's
  witness/refinery/polecats, with name, role, rig, and running/idle/working
  state, live-updated the same way hook/mail/rigs/beads already are.
- On-demand visibility into what an agent is actually doing: a recent
  snapshot of its tmux pane's terminal output, fetched only while a user
  is looking at that agent.

**Non-goals (this round)**
- No chat with Mayor or any other agent (ACP bridge — separate, blocked
  effort).
- No sending nudges or messages to agents from the UI (read-only this
  round; the original Phase-1-deferred "Activity feed" nudge-sending
  concept is not part of this).
- No continuous/streaming pane output — a few-seconds-stale snapshot,
  refreshed by polling while a detail view is open, is sufficient; no new
  bidirectional WebSocket protocol.
- No interpretation of pane content (no ANSI color rendering, no attempt
  to parse agent state out of the text) — it's shown as plain, monospace
  text for a human to read.

## Architecture

Extends the existing Phase 1 server and client without introducing new
subsystems:

```
Server (existing: cli-adapter, poll-scheduler, api, auth)
  cli-adapter/
    gt.ts        + getAgents(): parses `gt status --json`'s agents
                   (flattening top-level + every rig's nested agents)
    tmux.ts       (new) capturePane(session, lines): wraps
                   `tmux capture-pane -t <session> -p -S -<lines>`
  poll-scheduler/  unchanged — `agents` becomes a 5th Poller<AgentSummary[]>
  api/
    routes.ts     + GET /api/status/agents  (existing pattern: snapshot)
                  + GET /api/agents/:session/pane  (new: on-demand, not
                    polled server-side; session validated against the
                    current agents snapshot before shelling to tmux)
    ws.ts         SnapshotMessage union gains a 5th `resource: 'agents'`
                   variant; pane capture is NOT broadcast over WS (it's
                   REST-only, fetched on demand)

Client (existing: api, components)
  api/types.ts     + AgentSummary type, extended SnapshotMessage union
  api/client.ts     unchanged (apiFetch already generic)
  components/
    AgentsRoster.tsx   (new) table of agents from the `agents` resource
    AgentPanel.tsx     (new) detail view: polls the pane endpoint every
                        few seconds while mounted, plain-text render
  App.tsx           gains a simple two-section layout: existing
                     Dashboard, plus the new agent roster + detail panel
```

## Data shapes

`gt status --json`'s `agents` (top-level) and each `rigs[].agents` entries
share one shape; verified against the live `gt` binary:

```json
{
  "name": "witness", "address": "allay/witness", "session": "al-witness",
  "role": "witness", "running": true, "acp": false, "has_work": false,
  "state": "idle", "unread_mail": 0, "agent_alias": "codex",
  "agent_info": "codex"
}
```

`getAgents()` flattens this into one list, adding a `rig` field (the rig
name for rig-scoped agents, `null` for town-level mayor/deacon):

```ts
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

`capturePane(session, lines)` returns a plain string (already
ANSI-free, since `-e` is never passed to `capture-pane`), capped by
`safeExec`'s existing output-size limit.

## Security

- `GET /api/agents/:session/pane` validates `:session` against the
  **current cached `agents` snapshot** (i.e., a session that's actually a
  known agent right now) before calling `tmux capture-pane` — this
  prevents a client from probing arbitrary tmux session names on the
  host, even though `execFile`+argv already prevents shell injection. An
  unknown session returns 404, not a tmux error.
- Pane text is rendered as plain React text content on the client, never
  `dangerouslySetInnerHTML` — agent output cannot execute anything in the
  browser regardless of its content.
- The new REST route sits behind the same `hostMiddleware` +
  `tokenMiddleware` as every existing route; no new auth surface.
- `capturePane` uses `safeExec` with a fixed command and argv array
  exactly like every other CLI call in this codebase — no exceptions.

## Error handling

- The `agents` resource follows the exact existing poller/snapshot
  pattern: a `gt status --json` failure leaves the last-known roster
  displayed, marked stale, same as hook/mail/rigs/beads.
- A pane-capture failure (session no longer exists, `tmux` not
  installed, `capture-pane` errors) surfaces as an inline error inside
  that one agent's detail panel only — it never affects the roster or
  any other agent's panel.

## Testing

- Server unit tests: `getAgents()` parsing/flattening (mocked
  `safeExec`), `capturePane()` (mocked `safeExec`), the pane route's
  session-allowlist check (401 no token, 404 unknown session, 200 known
  session).
- Poller/WS wiring tests for the 5th `agents` resource, following the
  exact pattern already established for hook/mail/rigs/beads.
- Client tests: roster rendering (loading/data/error/stale, reusing
  `SnapshotCard`'s state logic where it fits), detail panel
  fetch-on-mount / poll-while-open / stop-on-unmount, and an explicit
  test asserting pane content renders as text (not interpreted as HTML).
- Opt-in live contract tests (gated behind `ALLAY_LIVE_TESTS=1`, matching
  Phase 1's pattern) for both `getAgents()` and `capturePane()` against
  the real `gt` binary and a real tmux session — this Mayor session
  itself is a live Gas Town tmux session, so a real end-to-end check is
  possible during implementation.

## Rollout

This is a single, self-contained increment on top of the merged Phase 1
branch — no further decomposition needed. One implementation plan,
executed the same way as Phase 1 (subagent-driven development, isolated
worktree, per-task review, final whole-branch review).

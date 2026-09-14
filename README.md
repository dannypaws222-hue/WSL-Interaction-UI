# Allay

A polished, unified interface for interacting with Gas Town —
chat with Mayor and monitor rig/agent status in one place, in
the spirit of the Claude Code and Codex UIs.

Status: Phase 1 (monitoring dashboard) implemented.

## Running Allay

This is an npm workspaces repo with two packages: `server` and `client`.

1. Install dependencies once, from the repo root:

   ```
   npm install
   ```

2. Start the server:

   ```
   npm run dev --workspace server
   ```

   On startup it prints the server's own URL (loopback only) and an auth
   token, plus the client URL you should open (see below). The token is
   generated once and persisted to disk (`~/.allay/token` by default), so it
   stays the same across restarts.

3. Start the client, in a separate terminal:

   ```
   npm run dev --workspace client
   ```

   This runs Vite's dev server, which prints its own URL (typically
   `http://127.0.0.1:5173`, Vite's default port — the exact port can differ
   if 5173 is already in use, so use whatever URL Vite actually prints).

4. Open the client with the token from the server's startup log appended as
   a query parameter, e.g.:

   ```
   http://127.0.0.1:5173/?token=<token from the server's log>
   ```

   You only need to do this once — the token is then stored in
   `localStorage` and reused on subsequent visits. If you open the client
   without a token (and none is stored yet), the page will tell you so
   instead of silently hanging.

   Note: the server does not serve the built client itself (no static
   file middleware) — the client always runs as its own process via Vite.
   Opening the server's own URL directly in a browser will just 404.

## The Beads card and `bd`'s working-directory requirement

The Beads card is populated by shelling out to `bd list --json --status=open`
from the server process's current working directory. `bd` discovers which
workspace (`.beads` directory) to use by walking up from the cwd, and **that
walk does not cross git-repository boundaries** — it stops at the git repo
root of wherever the server was started from. This is a deliberate adapter
design (`server/src/cli-adapter/bd.ts` intentionally does not accept a `cwd`
or `BEADS_DIR` override), not a bug you can fix from the UI.

Concretely, in this repository's own layout: this `allay` package lives at
`.../allay/mayor/rig` (its own git repo), and a checkout like
`.../allay/mayor/rig/.worktrees/phase1-monitoring` is yet another, separate
git-repository boundary nested inside it. Neither of those has a `.beads`
directory anywhere in its own git lineage — the target rig's `.beads` lives
several levels further up, at `.../allay/.beads`, outside both repos'
ancestry entirely.

**If you run `npm run dev --workspace server` from inside a nested clone or
worktree like the one above, the Beads card will show a persistent error.**
This is expected, not a bug. To get a working Beads card, run the server
from a working directory whose filesystem/git lineage actually contains the
target rig's `.beads` directory — for example, from somewhere under the rig
root (`.../allay/`) itself, rather than from a nested git worktree or clone
that has no `.beads` of its own.

The Hook, Mail, and Rigs cards go through `gt` rather than `bd`, so they are
not subject to this specific `bd` cwd/`.beads`-discovery limitation — but
`gt` has its own environment/identity requirements (see `gt prime`), so make
sure those are satisfied wherever you run the server too.

## Agents

The Agents card shows every agent in the town — mayor, deacon, and every
rig's witness/refinery/polecats — with its name, role, rig, and current
running/idle/working state, live-updated the same way the Hook/Mail/Rigs/Beads
cards are.

Clicking the name of a **running** agent opens a detail panel showing a
recent snapshot of that agent's tmux pane (its terminal output), refreshed by
polling every few seconds while the panel is open. A non-running agent's name
is not clickable — there is no tmux session to capture, so the row simply
shows "stopped" in the State column instead.

This feature requires `tmux` to be on `PATH`, in addition to `gt`/`bd`. It
also requires — same as the Beads card's requirement above — that the server
be run from a location where `gt status --json` resolves the intended town's
tmux socket; the pane capture shells out via `gt status --json`'s reported
`tmux.socket_path`, so it is subject to the same `gt` environment/identity
requirements as the Hook/Mail/Rigs cards.

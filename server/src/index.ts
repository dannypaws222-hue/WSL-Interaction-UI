import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { attachSnapshotSocket } from './api/ws.js';
import { getOrCreateToken } from './auth/token.js';
import { getHook, getMailInbox, getRigList, getAgents } from './cli-adapter/gt.js';
import { listIssues } from './cli-adapter/bd.js';
import { Poller } from './poll-scheduler/poller.js';
import { capturePane } from './cli-adapter/tmux.js';

const PORT = Number(process.env.ALLAY_PORT ?? 4317);
const TOKEN_PATH = process.env.ALLAY_TOKEN_PATH ?? path.join(os.homedir(), '.allay', 'token');

const token = getOrCreateToken(TOKEN_PATH);

const pollers = {
  hook: new Poller(getHook, { intervalMs: 3000 }),
  mail: new Poller(getMailInbox, { intervalMs: 5000 }),
  rigs: new Poller(getRigList, { intervalMs: 5000 }),
  beads: new Poller(() => listIssues({ status: 'open' }), { intervalMs: 5000 }),
  agents: new Poller(getAgents, { intervalMs: 5000 }),
};

pollers.hook.start();
pollers.mail.start();
pollers.rigs.start();
pollers.beads.start();
pollers.agents.start();

const app = createApp(pollers, () => token, capturePane);
const server = createServer(app);
attachSnapshotSocket(server, pollers, () => token);

server.on('error', (err) => {
  console.error('[allay] server error:', err);
  process.exit(1);
});

function shutdown(): void {
  pollers.hook.stop();
  pollers.mail.stop();
  pollers.rigs.stop();
  pollers.beads.stop();
  pollers.agents.stop();
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '127.0.0.1', () => {
  const clientUrl = `http://127.0.0.1:5173/?token=${token}`;
  console.log(`Allay server listening on http://127.0.0.1:${PORT} (loopback only)`);
  console.log('This server does not serve the client — start it separately:');
  console.log('  npm run dev --workspace client');
  console.log('Then open the Vite dev server\'s printed URL (typically http://127.0.0.1:5173) with the token appended, e.g.:');
  console.log(`  ${clientUrl}`);
  console.log("The token is remembered in localStorage after the first load, so you only need the query param once.");
});

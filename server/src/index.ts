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

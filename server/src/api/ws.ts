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

  wss.on('error', (err) => {
    console.error('[allay] websocket server error:', err);
  });

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

    ws.on('error', (err) => {
      console.error('[allay] websocket connection error:', err);
    });

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

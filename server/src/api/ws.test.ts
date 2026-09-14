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

function buildPollers(): PollerMap & {
  hook: ReturnType<typeof fakeObservable<HookStatus>>;
  mail: ReturnType<typeof fakeObservable<MailMessage[]>>;
  rigs: ReturnType<typeof fakeObservable<RigSummary[]>>;
  beads: ReturnType<typeof fakeObservable<BeadSummary[]>>;
} {
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
  const wss = attachSnapshotSocket(server, pollers, () => 'tok');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port, wss };
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

  it('does not crash on a protocol-level error and keeps serving new connections', async () => {
    const pollers = buildPollers();
    const { server, port, wss } = await startServer(pollers);

    const serverWsPromise = new Promise<WebSocket>((resolve) => {
      wss.once('connection', (ws) => resolve(ws));
    });

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const initialA = nextNMessages(wsA, 4);
    await new Promise<void>((resolve) => wsA.on('open', resolve));
    await initialA;

    const serverWs = await serverWsPromise;

    // Simulate a protocol-level error on the server-side connection socket,
    // as would happen with a malformed frame from a misbehaving client.
    // `ws` sockets are EventEmitters: without a server-side 'error' listener
    // attached inside the connection handler, this emit would throw
    // synchronously here (and, in production, be an uncaught exception that
    // crashes the whole Node process).
    expect(() => serverWs.emit('error', new Error('simulated protocol error'))).not.toThrow();

    // The server must still be able to serve a brand-new connection afterward.
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    const initialB = nextNMessages(wsB, 4);
    await new Promise<void>((resolve, reject) => {
      wsB.on('open', resolve);
      wsB.on('error', reject);
    });
    const messagesB = await initialB;
    expect(new Set(messagesB.map((m) => m.resource))).toEqual(new Set(['hook', 'mail', 'rigs', 'beads']));

    wsA.close();
    wsB.close();
    server.close();
  });
});

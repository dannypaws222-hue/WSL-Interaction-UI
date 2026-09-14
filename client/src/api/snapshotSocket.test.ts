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

  it('ignores a malformed message instead of throwing inside the event handler', () => {
    const messages: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    new SnapshotSocketClient({
      baseWsUrl: '',
      onMessage: (m) => messages.push(m),
      WebSocketImpl: FakeWebSocket as any,
    });

    expect(() => FakeWebSocket.instances[0].emit('message', { data: 'not json' })).not.toThrow();
    expect(messages).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
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

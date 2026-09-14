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

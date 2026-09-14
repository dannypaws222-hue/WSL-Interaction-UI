import { describe, it, expect, vi, beforeEach } from 'vitest';

// The socket path is memoized at module scope (see tmux.ts), so each test
// gets a fresh module graph (and a fresh, unspied `exec.js`) via
// vi.resetModules() + dynamic import — otherwise the cache populated by
// one test would leak into the next and change its expected call counts.
describe('capturePane', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWithMockedExec() {
    const execModule = await import('./exec.js');
    vi.spyOn(execModule, 'safeExec').mockReset();
    const { capturePane } = await import('./tmux.js');
    return { safeExec: execModule.safeExec, capturePane };
  }

  it('discovers the tmux socket via gt status --json, then captures the pane', async () => {
    const { safeExec, capturePane } = await loadWithMockedExec();
    vi.mocked(safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket: 'gt-abc', socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('line one\nline two\n');

    const result = await capturePane('hq-mayor', 20);

    expect(safeExec).toHaveBeenNthCalledWith(1, 'gt', ['status', '--json']);
    expect(safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-20',
    ]);
    expect(result).toBe('line one\nline two\n');
  });

  it('defaults to 50 lines when not specified', async () => {
    const { safeExec, capturePane } = await loadWithMockedExec();
    vi.mocked(safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('');

    await capturePane('hq-mayor');

    expect(safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-50',
    ]);
  });

  it('throws when gt status --json is missing tmux.socket_path', async () => {
    const { safeExec, capturePane } = await loadWithMockedExec();
    vi.mocked(safeExec).mockResolvedValueOnce(JSON.stringify({ tmux: {} }));
    await expect(capturePane('hq-mayor')).rejects.toThrow(/socket_path/i);
  });

  it('memoizes the socket path: a second capturePane call skips the gt status lookup', async () => {
    const { safeExec, capturePane } = await loadWithMockedExec();
    vi.mocked(safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('first capture')
      .mockResolvedValueOnce('second capture');

    const first = await capturePane('hq-mayor');
    expect(safeExec).toHaveBeenCalledTimes(2); // status + capture
    expect(first).toBe('first capture');

    const second = await capturePane('hq-mayor');
    expect(safeExec).toHaveBeenCalledTimes(3); // no repeated status call — straight to capture
    expect(safeExec).toHaveBeenNthCalledWith(3, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-50',
    ]);
    expect(second).toBe('second capture');
  });

  it('clears the cached socket path when a capture fails, re-discovering it on the next call', async () => {
    const { safeExec, capturePane } = await loadWithMockedExec();
    vi.mocked(safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockRejectedValueOnce(new Error('tmux: session not found'))
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-xyz' } }))
      .mockResolvedValueOnce('recovered capture');

    await expect(capturePane('hq-mayor')).rejects.toThrow(/session not found/);
    expect(safeExec).toHaveBeenCalledTimes(2); // status + failed capture

    const result = await capturePane('hq-mayor');
    expect(safeExec).toHaveBeenCalledTimes(4); // re-discovers status, then captures again
    expect(safeExec).toHaveBeenNthCalledWith(3, 'gt', ['status', '--json']);
    expect(safeExec).toHaveBeenNthCalledWith(4, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-xyz', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-50',
    ]);
    expect(result).toBe('recovered capture');
  });
});

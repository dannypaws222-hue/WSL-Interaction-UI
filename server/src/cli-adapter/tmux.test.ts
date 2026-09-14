import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as execModule from './exec.js';
import { capturePane } from './tmux.js';

describe('capturePane', () => {
  beforeEach(() => {
    vi.spyOn(execModule, 'safeExec').mockReset();
  });

  it('discovers the tmux socket via gt status --json, then captures the pane', async () => {
    vi.mocked(execModule.safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket: 'gt-abc', socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('line one\nline two\n');

    const result = await capturePane('hq-mayor', 20);

    expect(execModule.safeExec).toHaveBeenNthCalledWith(1, 'gt', ['status', '--json']);
    expect(execModule.safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-20',
    ]);
    expect(result).toBe('line one\nline two\n');
  });

  it('defaults to 50 lines when not specified', async () => {
    vi.mocked(execModule.safeExec)
      .mockResolvedValueOnce(JSON.stringify({ tmux: { socket_path: '/tmp/tmux-1000/gt-abc' } }))
      .mockResolvedValueOnce('');

    await capturePane('hq-mayor');

    expect(execModule.safeExec).toHaveBeenNthCalledWith(2, 'tmux', [
      '-S', '/tmp/tmux-1000/gt-abc', 'capture-pane', '-t', 'hq-mayor', '-p', '-S', '-50',
    ]);
  });

  it('throws when gt status --json is missing tmux.socket_path', async () => {
    vi.mocked(execModule.safeExec).mockResolvedValueOnce(JSON.stringify({ tmux: {} }));
    await expect(capturePane('hq-mayor')).rejects.toThrow(/socket_path/i);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { safeExec } from './exec.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

describe('safeExec', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it('resolves with stdout on success', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as any)(null, '{"ok":true}', '');
      return {} as any;
    });

    await expect(safeExec('gt', ['status', '--json'])).resolves.toBe('{"ok":true}');
  });

  it('rejects with a TIMEOUT SafeExecError when the process is killed by timeout', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      const err: any = new Error('Command timed out');
      err.killed = true;
      err.signal = 'SIGTERM';
      (cb as any)(err, '', '');
      return {} as any;
    });

    await expect(safeExec('gt', ['status'], { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('rejects with a NONZERO_EXIT SafeExecError and includes stderr', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) => {
      const err: any = new Error('Command failed');
      err.code = 1;
      (cb as any)(err, '', 'boom');
      return {} as any;
    });

    await expect(safeExec('gt', ['status'])).rejects.toMatchObject({
      code: 'NONZERO_EXIT',
      stderr: 'boom',
    });
  });
});

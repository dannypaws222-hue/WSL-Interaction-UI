import { describe, it, expect, vi } from 'vitest';
import * as execModule from './exec.js';
import { listIssues } from './bd.js';

describe('bd.ts', () => {
  it('listIssues() calls `bd list --json` with no filter by default', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { id: 'al-1', title: 'Do a thing', status: 'open', priority: 2, issue_type: 'task' },
    ]));

    const result = await listIssues();
    expect(execModule.safeExec).toHaveBeenCalledWith('bd', ['list', '--json']);
    expect(result[0].id).toBe('al-1');
  });

  it('listIssues({ status }) appends a --status flag', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue('[]');
    await listIssues({ status: 'open' });
    expect(execModule.safeExec).toHaveBeenCalledWith('bd', ['list', '--json', '--status=open']);
  });

  it('listIssues() rejects when the CLI returns an object instead of an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ id: 'al-1' }));
    await expect(listIssues()).rejects.toThrow(/unexpected shape/i);
  });
});

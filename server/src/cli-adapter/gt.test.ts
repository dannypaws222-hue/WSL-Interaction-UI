import { describe, it, expect, vi } from 'vitest';
import * as execModule from './exec.js';
import { getHook, getMailInbox, getRigList } from './gt.js';

describe('gt.ts', () => {
  it('getHook() calls `gt hook --json` and parses the result', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
      target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor',
      has_work: false, is_wisp: false, next_action: 'wait',
    }));

    const result = await getHook();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['hook', '--json']);
    expect(result.role).toBe('mayor');
  });

  it('getHook() rejects when required fields are missing', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ role: 'mayor' }));
    await expect(getHook()).rejects.toThrow(/unexpected shape/i);
  });

  it('getMailInbox() calls `gt mail inbox --json` and parses an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { id: 'hq-1', from: 'deacon/', to: 'mayor/', subject: 'hi', timestamp: 't', read: false, priority: 'low', type: 'wisp' },
    ]));

    const result = await getMailInbox();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['mail', 'inbox', '--json']);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('hi');
  });

  it('getMailInbox() rejects when the CLI returns an object instead of an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ id: 'hq-1' }));
    await expect(getMailInbox()).rejects.toThrow(/unexpected shape/i);
  });

  it('getRigList() calls `gt rig list --json` and parses an array', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify([
      { name: 'allay', beads_prefix: 'al', status: 'operational', witness: 'running', refinery: 'stopped', polecats: 0, crew: 0 },
    ]));

    const result = await getRigList();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['rig', 'list', '--json']);
    expect(result[0].name).toBe('allay');
  });

  it('rejects when the CLI returns malformed JSON', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue('not json');
    await expect(getHook()).rejects.toThrow();
  });
});

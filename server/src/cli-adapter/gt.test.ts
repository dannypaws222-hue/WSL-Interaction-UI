import { describe, it, expect, vi } from 'vitest';
import * as execModule from './exec.js';
import { getHook, getMailInbox, getRigList, getAgents } from './gt.js';

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

  it('getAgents() flattens town-level and rig-level agents, tagging rig', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
      agents: [
        { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', running: true, state: 'idle', has_work: false },
      ],
      rigs: [
        {
          name: 'allay',
          agents: [
            { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', running: true, state: 'idle', has_work: false },
          ],
        },
      ],
      tmux: { socket: 'gt-f96c12', socket_path: '/tmp/tmux-1000/gt-f96c12' },
    }));

    const result = await getAgents();
    expect(execModule.safeExec).toHaveBeenCalledWith('gt', ['status', '--json']);
    expect(result).toEqual([
      { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
      { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: false },
    ]);
  });

  it('getAgents() handles a rig with no agents field gracefully', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({
      agents: [],
      rigs: [{ name: 'empty-rig' }],
      tmux: { socket: 'x', socket_path: '/tmp/x' },
    }));
    await expect(getAgents()).resolves.toEqual([]);
  });

  it('getAgents() rejects when the CLI returns an unexpected shape', async () => {
    vi.spyOn(execModule, 'safeExec').mockResolvedValue(JSON.stringify({ agents: 'not-an-array', rigs: [] }));
    await expect(getAgents()).rejects.toThrow(/unexpected shape/i);
  });
});

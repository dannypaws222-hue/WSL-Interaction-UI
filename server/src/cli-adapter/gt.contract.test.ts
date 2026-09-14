import { describe, it, expect } from 'vitest';
import { getHook, getMailInbox, getRigList, getAgents } from './gt.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('gt.ts (live CLI contract)', () => {
  it('getHook() matches HookStatus against the real gt CLI', async () => {
    const result = await getHook();
    expect(typeof result.role).toBe('string');
    expect(typeof result.has_work).toBe('boolean');
    expect(typeof result.agent_bead_id).toBe('string');
  });

  it('getMailInbox() returns an array of messages with the expected fields', async () => {
    const result = await getMailInbox();
    expect(Array.isArray(result)).toBe(true);
    for (const message of result) {
      expect(typeof message.id).toBe('string');
      expect(typeof message.subject).toBe('string');
      expect(typeof message.read).toBe('boolean');
    }
  });

  it('getRigList() returns an array against the real gt CLI', async () => {
    const result = await getRigList();
    expect(Array.isArray(result)).toBe(true);
    for (const rig of result) {
      expect(typeof rig.name).toBe('string');
    }
  });

  it('getAgents() returns a non-empty array including this town\'s mayor, against the real gt CLI', async () => {
    const result = await getAgents();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const mayor = result.find((a) => a.role === 'coordinator' || a.address === 'mayor/');
    expect(mayor).toBeDefined();
    for (const agent of result) {
      expect(typeof agent.session).toBe('string');
      expect(typeof agent.name).toBe('string');
    }
  });
});

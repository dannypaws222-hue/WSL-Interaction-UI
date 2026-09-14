import { describe, it, expect } from 'vitest';
import { getHook, getMailInbox, getRigList } from './gt.js';

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
});

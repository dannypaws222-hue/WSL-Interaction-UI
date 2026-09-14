import { describe, it, expect } from 'vitest';
import { listIssues } from './bd.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('bd.ts (live CLI contract)', () => {
  it('listIssues() returns an array of beads with the expected fields', async () => {
    const result = await listIssues({ status: 'open' });
    expect(Array.isArray(result)).toBe(true);
    for (const bead of result) {
      expect(typeof bead.id).toBe('string');
      expect(typeof bead.title).toBe('string');
    }
  });
});

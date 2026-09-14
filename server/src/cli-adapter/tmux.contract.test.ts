import { describe, it, expect } from 'vitest';
import { getAgents } from './gt.js';
import { capturePane } from './tmux.js';

const liveDescribe = process.env.ALLAY_LIVE_TESTS === '1' ? describe : describe.skip;

liveDescribe('capturePane (live tmux contract)', () => {
  it('captures real pane text for a real running agent session', async () => {
    const agents = await getAgents();
    const running = agents.find((a) => a.running);
    expect(running).toBeDefined();

    const pane = await capturePane(running!.session, 10);
    expect(typeof pane).toBe('string');
  }, 20_000);
});

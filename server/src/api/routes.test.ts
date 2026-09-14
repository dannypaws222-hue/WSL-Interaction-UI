import request from 'supertest';
import express from 'express';
import { describe, it, expect, vi } from 'vitest';
import { createApiRouter, type PollerMap } from './routes.js';
import type { PollSnapshot } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary, AgentSummary } from '../cli-adapter/types.js';

function fakeSource<T>(snapshot: PollSnapshot<T>) {
  return { getSnapshot: () => snapshot, onUpdate: () => () => {} };
}

function buildPollers(): PollerMap {
  return {
    hook: fakeSource<HookStatus>({ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }),
    mail: fakeSource<MailMessage[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    rigs: fakeSource<RigSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    beads: fakeSource<BeadSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    agents: fakeSource<AgentSummary[]>({ data: [{ name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false }], lastSuccessAt: 1, lastError: null, isStale: false }),
  };
}

describe('createApiRouter', () => {
  const token = 'test-token';

  function buildApp() {
    const app = express();
    app.use('/api', createApiRouter(buildPollers(), () => token, vi.fn()));
    return app;
  }

  it('returns the hook snapshot when the token matches', async () => {
    const res = await request(buildApp()).get('/api/status/hook').set('x-allay-token', token);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('mayor');
  });

  it('returns 401 without a valid token', async () => {
    const res = await request(buildApp()).get('/api/status/hook');
    expect(res.status).toBe(401);
  });

  it.each(['hook', 'mail', 'rigs', 'beads'])('exposes a %s route', async (resource) => {
    const res = await request(buildApp()).get(`/api/status/${resource}`).set('x-allay-token', token);
    expect(res.status).toBe(200);
  });

  it('exposes an agents route', async () => {
    const res = await request(buildApp()).get('/api/status/agents').set('x-allay-token', token);
    expect(res.status).toBe(200);
    expect(res.body.data[0].session).toBe('hq-mayor');
  });
});

describe('GET /api/agents/:session/pane', () => {
  const token = 'test-token';

  function buildAppWithPane(capturePane: (session: string, lines?: number) => Promise<string>) {
    const app = express();
    app.use('/api', createApiRouter(buildPollers(), () => token, capturePane));
    return app;
  }

  it('returns pane text for a known agent session', async () => {
    const capturePane = vi.fn().mockResolvedValue('some pane output');
    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/hq-mayor/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(200);
    expect(res.body.session).toBe('hq-mayor');
    expect(res.body.pane).toBe('some pane output');
    expect(capturePane).toHaveBeenCalledWith('hq-mayor');
  });

  it('returns 404 for a session not in the current agents roster (no capturePane call)', async () => {
    const capturePane = vi.fn();
    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/not-a-real-session/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(404);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('returns 401 without a valid token, before checking the session', async () => {
    const capturePane = vi.fn();
    const res = await request(buildAppWithPane(capturePane)).get('/api/agents/hq-mayor/pane');
    expect(res.status).toBe(401);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('returns a generic 502 body when capturePane itself fails, logging the real error server-side', async () => {
    const capturePane = vi.fn().mockRejectedValue(new Error('tmux not found at /tmp/tmux-1000/gt-f96c12'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(buildAppWithPane(capturePane))
      .get('/api/agents/hq-mayor/pane')
      .set('x-allay-token', token);

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'pane capture failed' });
    expect(res.body.error).not.toMatch(/tmux not found/);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';
import { createApiRouter, type PollerMap } from './routes.js';
import type { PollSnapshot } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';

function fakeSource<T>(snapshot: PollSnapshot<T>) {
  return { getSnapshot: () => snapshot, onUpdate: () => () => {} };
}

function buildPollers(): PollerMap {
  return {
    hook: fakeSource<HookStatus>({ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }),
    mail: fakeSource<MailMessage[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    rigs: fakeSource<RigSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
    beads: fakeSource<BeadSummary[]>({ data: [], lastSuccessAt: 1, lastError: null, isStale: false }),
  };
}

describe('createApiRouter', () => {
  const token = 'test-token';

  function buildApp() {
    const app = express();
    app.use('/api', createApiRouter(buildPollers(), () => token));
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
});

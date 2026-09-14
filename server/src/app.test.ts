import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { PollerMap } from './api/routes.js';

function fakeSource<T>(data: T) {
  return {
    getSnapshot: () => ({ data, lastSuccessAt: 1, lastError: null, isStale: false }),
    onUpdate: () => () => {},
  };
}

function buildPollers(): PollerMap {
  return {
    hook: fakeSource({ target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }),
    mail: fakeSource([]),
    rigs: fakeSource([]),
    beads: fakeSource([]),
  };
}

describe('createApp', () => {
  const token = 'test-token';

  it('responds to /healthz without requiring the token (Host is still checked by supertest\'s default 127.0.0.1 Host header)', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('rejects /healthz when the Host header is not local', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/healthz').set('Host', 'evil.example.com');
    expect(res.status).toBe(400);
  });

  it('serves /api routes behind the token', async () => {
    const app = createApp(buildPollers(), () => token);
    const res = await request(app).get('/api/status/hook').set('x-allay-token', token);
    expect(res.status).toBe(200);
  });
});

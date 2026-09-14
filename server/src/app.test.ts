import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
  it('responds to /healthz', async () => {
    const app = createApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

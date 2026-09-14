import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  getOrCreateToken,
  tokenMiddleware,
  hostMiddleware,
  verifyWsToken,
  isAllowedLocalOrigin,
  isAllowedLocalHost,
} from './token.js';

describe('getOrCreateToken', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'allay-token-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a token file if none exists and returns a non-empty token', () => {
    const filePath = join(dir, 'nested', 'token');
    const token = getOrCreateToken(filePath);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(filePath, 'utf8').trim()).toBe(token);
  });

  it('returns the same token on a second call', () => {
    const filePath = join(dir, 'token');
    const first = getOrCreateToken(filePath);
    const second = getOrCreateToken(filePath);
    expect(second).toBe(first);
  });

  it('regenerates when the existing file is empty', () => {
    const filePath = join(dir, 'token');
    writeFileSync(filePath, '');
    const token = getOrCreateToken(filePath);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('tokenMiddleware', () => {
  function buildApp() {
    const app = express();
    app.use(tokenMiddleware(() => 'expected-token'));
    app.get('/protected', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests with the correct token', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'expected-token');
    expect(res.status).toBe(200);
  });

  it('rejects requests with no token', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an incorrect token of the same length', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'wrong-token!');
    expect(res.status).toBe(401);
  });

  it('rejects requests with an incorrect token of a different length', async () => {
    const res = await request(buildApp()).get('/protected').set('x-allay-token', 'short');
    expect(res.status).toBe(401);
  });
});

describe('hostMiddleware', () => {
  function buildApp() {
    const app = express();
    app.use(hostMiddleware());
    app.get('/anything', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests with a loopback Host header', async () => {
    const res = await request(buildApp()).get('/anything').set('Host', '127.0.0.1:4317');
    expect(res.status).toBe(200);
  });

  it('rejects requests with a non-local Host header', async () => {
    const res = await request(buildApp()).get('/anything').set('Host', 'evil.example.com');
    expect(res.status).toBe(400);
  });
});

describe('verifyWsToken', () => {
  it('accepts a request whose query token matches', () => {
    const req = { url: '/ws?token=expected-token' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(true);
  });

  it('rejects a request with no token', () => {
    const req = { url: '/ws' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(false);
  });

  it('rejects a request with an incorrect token', () => {
    const req = { url: '/ws?token=wrong-token' } as any;
    expect(verifyWsToken(() => 'expected-token', req)).toBe(false);
  });
});

describe('isAllowedLocalOrigin', () => {
  it('accepts http(s) origins on 127.0.0.1 or localhost, any port', () => {
    expect(isAllowedLocalOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedLocalOrigin('http://localhost:4317')).toBe(true);
    expect(isAllowedLocalOrigin('https://localhost')).toBe(true);
  });

  it('rejects missing, malformed, or non-local origins', () => {
    expect(isAllowedLocalOrigin(undefined)).toBe(false);
    expect(isAllowedLocalOrigin('not-a-url')).toBe(false);
    expect(isAllowedLocalOrigin('http://evil.example.com')).toBe(false);
  });
});

describe('isAllowedLocalHost', () => {
  it('accepts loopback hosts with or without a port', () => {
    expect(isAllowedLocalHost('127.0.0.1:4317')).toBe(true);
    expect(isAllowedLocalHost('localhost')).toBe(true);
  });

  it('rejects missing or non-local hosts', () => {
    expect(isAllowedLocalHost(undefined)).toBe(false);
    expect(isAllowedLocalHost('evil.example.com')).toBe(false);
  });
});

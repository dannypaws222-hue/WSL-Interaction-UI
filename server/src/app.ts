import express from 'express';
import { createApiRouter, type PollerMap } from './api/routes.js';
import { hostMiddleware } from './auth/token.js';

export function createApp(
  pollers: PollerMap,
  getToken: () => string,
  capturePane: (session: string, lines?: number) => Promise<string>
) {
  const app = express();
  app.use(hostMiddleware());
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', createApiRouter(pollers, getToken, capturePane));
  return app;
}

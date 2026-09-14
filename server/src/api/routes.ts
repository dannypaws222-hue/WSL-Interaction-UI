import { Router } from 'express';
import { tokenMiddleware } from '../auth/token.js';
import type { Observable } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary } from '../cli-adapter/types.js';

export interface PollerMap {
  hook: Observable<HookStatus>;
  mail: Observable<MailMessage[]>;
  rigs: Observable<RigSummary[]>;
  beads: Observable<BeadSummary[]>;
}

export function createApiRouter(pollers: PollerMap, getToken: () => string): Router {
  const router = Router();
  router.use(tokenMiddleware(getToken));

  router.get('/status/hook', (_req, res) => res.json(pollers.hook.getSnapshot()));
  router.get('/status/mail', (_req, res) => res.json(pollers.mail.getSnapshot()));
  router.get('/status/rigs', (_req, res) => res.json(pollers.rigs.getSnapshot()));
  router.get('/status/beads', (_req, res) => res.json(pollers.beads.getSnapshot()));

  return router;
}

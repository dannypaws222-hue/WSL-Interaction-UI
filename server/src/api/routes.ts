import { Router } from 'express';
import { tokenMiddleware } from '../auth/token.js';
import type { Observable } from '../poll-scheduler/poller.js';
import type { HookStatus, MailMessage, RigSummary, BeadSummary, AgentSummary } from '../cli-adapter/types.js';

export interface PollerMap {
  hook: Observable<HookStatus>;
  mail: Observable<MailMessage[]>;
  rigs: Observable<RigSummary[]>;
  beads: Observable<BeadSummary[]>;
  agents: Observable<AgentSummary[]>;
}

export function createApiRouter(
  pollers: PollerMap,
  getToken: () => string,
  capturePane: (session: string, lines?: number) => Promise<string>
): Router {
  const router = Router();
  router.use(tokenMiddleware(getToken));

  router.get('/status/hook', (_req, res) => res.json(pollers.hook.getSnapshot()));
  router.get('/status/mail', (_req, res) => res.json(pollers.mail.getSnapshot()));
  router.get('/status/rigs', (_req, res) => res.json(pollers.rigs.getSnapshot()));
  router.get('/status/beads', (_req, res) => res.json(pollers.beads.getSnapshot()));
  router.get('/status/agents', (_req, res) => res.json(pollers.agents.getSnapshot()));

  router.get('/agents/:session/pane', async (req, res) => {
    const { session } = req.params;
    const roster = pollers.agents.getSnapshot().data ?? [];
    const known = roster.some((agent) => agent.session === session);
    if (!known) {
      res.status(404).json({ error: 'unknown agent session' });
      return;
    }
    try {
      const pane = await capturePane(session);
      res.json({ session, pane, capturedAt: Date.now() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

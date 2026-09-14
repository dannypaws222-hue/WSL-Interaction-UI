import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import type { PaneResponse } from '../api/types';

export interface AgentPanelProps {
  session: string;
  onClose: () => void;
  pollIntervalMs?: number;
}

const MAX_BACKOFF_MS = 30_000;

export function AgentPanel({ session, onClose, pollIntervalMs = 3000 }: AgentPanelProps) {
  const [pane, setPane] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveFailures = 0;

    async function fetchPane() {
      try {
        const result = await apiFetch<PaneResponse>(`/api/agents/${encodeURIComponent(session)}/pane`);
        if (!cancelled) {
          setPane(result.pane);
          setError(null);
          consecutiveFailures = 0;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          consecutiveFailures += 1;
        }
      } finally {
        if (!cancelled) {
          // Chain the next poll only after this one settles (success or
          // failure) — this both prevents overlapping requests and, on
          // repeated consecutive failures, backs off exponentially (same
          // doubling pattern as the server-side Poller) instead of
          // hammering a dead endpoint every pollIntervalMs forever.
          const delay =
            consecutiveFailures > 0
              ? Math.min(pollIntervalMs * 2 ** consecutiveFailures, MAX_BACKOFF_MS)
              : pollIntervalMs;
          timer = setTimeout(fetchPane, delay);
        }
      }
    }

    fetchPane();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, pollIntervalMs]);

  return (
    <section aria-label={`${session} pane`}>
      <h2>{session}</h2>
      <button onClick={onClose}>Close</button>
      {error && <p role="alert">{error}</p>}
      <pre>{pane ?? 'Loading…'}</pre>
    </section>
  );
}

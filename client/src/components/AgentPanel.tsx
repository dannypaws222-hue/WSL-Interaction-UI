import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import type { PaneResponse } from '../api/types';

export interface AgentPanelProps {
  session: string;
  onClose: () => void;
  pollIntervalMs?: number;
}

export function AgentPanel({ session, onClose, pollIntervalMs = 3000 }: AgentPanelProps) {
  const [pane, setPane] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPane() {
      try {
        const result = await apiFetch<PaneResponse>(`/api/agents/${encodeURIComponent(session)}/pane`);
        if (!cancelled) {
          setPane(result.pane);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    fetchPane();
    const timer = setInterval(fetchPane, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
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

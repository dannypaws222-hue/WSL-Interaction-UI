import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { SnapshotSocketClient, type SnapshotSocketStatus } from './api/snapshotSocket';
import { resolveToken } from './api/client';
import type { PollSnapshot, HookStatus, MailMessage, RigSummary, BeadSummary, SnapshotMessage } from './api/types';

export function App() {
  const [hook, setHook] = useState<PollSnapshot<HookStatus> | null>(null);
  const [mail, setMail] = useState<PollSnapshot<MailMessage[]> | null>(null);
  const [rigs, setRigs] = useState<PollSnapshot<RigSummary[]> | null>(null);
  const [beads, setBeads] = useState<PollSnapshot<BeadSummary[]> | null>(null);
  const [status, setStatus] = useState<SnapshotSocketStatus>('connecting');
  const [hasToken] = useState<boolean>(() => resolveToken() !== null);

  useEffect(() => {
    if (!hasToken) return;
    const client = new SnapshotSocketClient({
      baseWsUrl: '', // same-origin, proxied by Vite in dev
      onStatusChange: setStatus,
      onMessage: (msg: SnapshotMessage) => {
        if (msg.resource === 'hook') setHook(msg.snapshot);
        if (msg.resource === 'mail') setMail(msg.snapshot);
        if (msg.resource === 'rigs') setRigs(msg.snapshot);
        if (msg.resource === 'beads') setBeads(msg.snapshot);
      },
    });
    return () => client.close();
  }, [hasToken]);

  if (!hasToken) {
    return (
      <main>
        <h1>Allay</h1>
        <p role="alert">
          No auth token found. Open this page with <code>?token=&lt;token&gt;</code> from the server's startup log.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Allay</h1>
      {status !== 'open' && <p role="alert">{status === 'reconnecting' ? 'Reconnecting to server…' : 'Connecting…'}</p>}
      <Dashboard hook={hook} mail={mail} rigs={rigs} beads={beads} />
    </main>
  );
}

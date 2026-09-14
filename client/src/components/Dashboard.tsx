import { SnapshotCard } from './SnapshotCard';
import type { PollSnapshot, HookStatus, MailMessage, RigSummary, BeadSummary } from '../api/types';

export interface DashboardProps {
  hook: PollSnapshot<HookStatus> | null;
  mail: PollSnapshot<MailMessage[]> | null;
  rigs: PollSnapshot<RigSummary[]> | null;
  beads: PollSnapshot<BeadSummary[]> | null;
}

export function Dashboard({ hook, mail, rigs, beads }: DashboardProps) {
  return (
    <div className="dashboard">
      <SnapshotCard title="Hook" snapshot={hook} renderData={(data) => (
        <p>{data.has_work ? `Working: ${data.agent_bead_id}` : 'Idle'}</p>
      )} />
      <SnapshotCard title="Mail" snapshot={mail} renderData={(data) => (
        data.length === 0
          ? <p>No mail</p>
          : <ul>{data.slice(0, 5).map((m) => <li key={m.id}>{m.read ? '' : '● '}{m.subject}</li>)}</ul>
      )} />
      <SnapshotCard title="Rigs" snapshot={rigs} renderData={(data) => (
        data.length === 0
          ? <p>No rigs</p>
          : <ul>{data.map((r) => <li key={r.name}>{r.name}: witness={r.witness}, refinery={r.refinery}</li>)}</ul>
      )} />
      <SnapshotCard title="Beads" snapshot={beads} renderData={(data) => (
        data.length === 0
          ? <p>No open items</p>
          : <ul>{data.slice(0, 10).map((b) => <li key={b.id}>{b.id}: {b.title}</li>)}</ul>
      )} />
    </div>
  );
}

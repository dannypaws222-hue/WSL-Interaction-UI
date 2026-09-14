import { SnapshotCard } from './SnapshotCard';
import type { PollSnapshot, AgentSummary } from '../api/types';

export interface AgentsRosterProps {
  agents: PollSnapshot<AgentSummary[]> | null;
  selectedSession: string | null;
  onSelect: (session: string) => void;
}

function stateLabel(agent: AgentSummary): string {
  if (!agent.running) return 'stopped';
  return agent.hasWork ? 'working' : agent.state;
}

export function AgentsRoster({ agents, selectedSession, onSelect }: AgentsRosterProps) {
  return (
    <SnapshotCard title="Agents" snapshot={agents} renderData={(data) => (
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>Rig</th><th>State</th></tr>
        </thead>
        <tbody>
          {data.map((agent) => (
            <tr key={agent.session}>
              <td>
                <button
                  onClick={() => onSelect(agent.session)}
                  aria-pressed={agent.session === selectedSession}
                  disabled={!agent.running}
                >
                  {agent.name}
                </button>
              </td>
              <td>{agent.role}</td>
              <td>{agent.rig ?? 'town'}</td>
              <td>{stateLabel(agent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )} />
  );
}

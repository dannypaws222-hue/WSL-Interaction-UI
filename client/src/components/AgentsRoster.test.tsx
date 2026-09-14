import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentsRoster } from './AgentsRoster';
import type { PollSnapshot, AgentSummary } from '../api/types';

function sampleSnapshot(): PollSnapshot<AgentSummary[]> {
  return {
    data: [
      { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
      { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: true },
    ],
    lastSuccessAt: 1,
    lastError: null,
    isStale: false,
  };
}

describe('AgentsRoster', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a row per agent with name, role, rig, and state', () => {
    render(<AgentsRoster agents={sampleSnapshot()} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    expect(screen.getByText('town')).toBeInTheDocument();
    expect(screen.getByText('allay')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('calls onSelect with the session when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<AgentsRoster agents={sampleSnapshot()} selectedSession={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('mayor'));
    expect(onSelect).toHaveBeenCalledWith('hq-mayor');
  });

  it('shows loading state when there is no snapshot yet', () => {
    render(<AgentsRoster agents={null} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state when the roster has never loaded and a poll failed', () => {
    render(
      <AgentsRoster
        agents={{ data: null, lastSuccessAt: null, lastError: 'gt not found', isStale: true }}
        selectedSession={null}
        onSelect={() => {}}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('gt not found');
  });

  it('shows a stale warning alongside existing data when the latest poll failed', () => {
    const stale = sampleSnapshot();
    stale.isStale = true;
    stale.lastError = 'boom';
    render(<AgentsRoster agents={stale} selectedSession={null} onSelect={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByText('mayor')).toBeInTheDocument();
  });

  it('disables the row button for a non-running agent', () => {
    const snapshot = sampleSnapshot();
    snapshot.data = [
      { name: 'stopped-polecat', address: 'allay/polecat-1', session: 'al-polecat-1', role: 'polecat', rig: 'allay', running: false, state: 'idle', hasWork: false },
    ];
    render(<AgentsRoster agents={snapshot} selectedSession={null} onSelect={() => {}} />);

    const button = screen.getByRole('button', { name: 'stopped-polecat' });
    expect(button).toBeDisabled();
    expect(screen.getByText('stopped')).toBeInTheDocument();
  });

  it('does not call onSelect when clicking a disabled (non-running) agent button', () => {
    const onSelect = vi.fn();
    const snapshot = sampleSnapshot();
    snapshot.data = [
      { name: 'stopped-polecat', address: 'allay/polecat-1', session: 'al-polecat-1', role: 'polecat', rig: 'allay', running: false, state: 'idle', hasWork: false },
    ];
    render(<AgentsRoster agents={snapshot} selectedSession={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'stopped-polecat' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves the row button enabled for a running agent, even with no work', () => {
    const snapshot = sampleSnapshot();
    snapshot.data = [
      { name: 'idle-witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: false },
    ];
    render(<AgentsRoster agents={snapshot} selectedSession={null} onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: 'idle-witness' })).not.toBeDisabled();
  });
});

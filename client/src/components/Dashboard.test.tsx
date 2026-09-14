import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
  it('renders all four sections with their data', () => {
    render(
      <Dashboard
        hook={{ data: { target: 'mayor/', role: 'mayor', agent_bead_id: 'hq-mayor', has_work: false, is_wisp: false, next_action: '' }, lastSuccessAt: 1, lastError: null, isStale: false }}
        mail={{ data: [{ id: 'hq-1', from: 'deacon/', to: 'mayor/', subject: 'Wisp Compaction', timestamp: 't', read: false, priority: 'low', type: 'wisp' }], lastSuccessAt: 1, lastError: null, isStale: false }}
        rigs={{ data: [{ name: 'allay', beads_prefix: 'al', status: 'operational', witness: 'running', refinery: 'stopped', polecats: 0, crew: 0 }], lastSuccessAt: 1, lastError: null, isStale: false }}
        beads={{ data: [{ id: 'al-1', title: 'Do a thing', status: 'open', priority: 2, issue_type: 'task' }], lastSuccessAt: 1, lastError: null, isStale: false }}
      />
    );

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText(/Wisp Compaction/)).toBeInTheDocument();
    expect(screen.getByText(/allay: witness=running/)).toBeInTheDocument();
    expect(screen.getByText(/al-1: Do a thing/)).toBeInTheDocument();
  });
});

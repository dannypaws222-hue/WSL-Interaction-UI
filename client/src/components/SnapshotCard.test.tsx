// client/src/components/SnapshotCard.test.tsx
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { SnapshotCard } from './SnapshotCard';

describe('SnapshotCard', () => {
  afterEach(() => {
    cleanup();
  });
  it('shows a loading state when there is no snapshot yet and no error', () => {
    render(<SnapshotCard title="Hook" snapshot={null} renderData={() => null} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state when there is no data yet but a poll already failed', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: null, lastSuccessAt: null, lastError: 'gt not found', isStale: true }}
        renderData={() => null}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('gt not found');
  });

  it('renders data, no stale warning, and the last-updated time when fresh', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: { role: 'mayor' }, lastSuccessAt: 1700000000000, lastError: null, isStale: false }}
        renderData={(data) => <p>{data.role}</p>}
      />
    );
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('shows a stale warning with the last error when data exists but the latest poll failed', () => {
    render(
      <SnapshotCard
        title="Hook"
        snapshot={{ data: { role: 'mayor' }, lastSuccessAt: 1700000000000, lastError: 'boom', isStale: true }}
        renderData={(data) => <p>{data.role}</p>}
      />
    );
    expect(screen.getByText('mayor')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});

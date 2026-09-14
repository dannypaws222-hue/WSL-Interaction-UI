import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { App } from './App';
import * as apiClient from './api/client';
import type { SnapshotSocketOptions } from './api/snapshotSocket';

let capturedOptions: SnapshotSocketOptions | null = null;

vi.mock('./api/snapshotSocket', () => ({
  SnapshotSocketClient: vi.fn().mockImplementation((options: SnapshotSocketOptions) => {
    capturedOptions = options;
    return { close: vi.fn() };
  }),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedOptions = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a distinct message instead of connecting when no auth token is found', () => {
    // jsdom's default location (http://localhost/) has no ?token=, and
    // localStorage was just cleared, so resolveToken() returns null.
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/no auth token found/i);
    expect(screen.queryByText(/reconnecting to server/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting…/i)).not.toBeInTheDocument();
  });

  it('renders the agents roster once an agents snapshot arrives, and opens a panel on selection', () => {
    localStorage.setItem('allay-token', 'tok');
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'test pane output', capturedAt: 1 });

    render(<App />);
    expect(capturedOptions).not.toBeNull();

    // Calling onMessage directly (not through a simulated DOM event)
    // schedules a React state update outside React's own event handling,
    // so it must be wrapped in act() or the assertion below can run
    // before the re-render commits.
    act(() => {
      capturedOptions!.onMessage({
        type: 'snapshot',
        resource: 'agents',
        snapshot: {
          data: [{ name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false }],
          lastSuccessAt: 1,
          lastError: null,
          isStale: false,
        },
      });
    });

    expect(screen.getByText('mayor')).toBeInTheDocument();

    fireEvent.click(screen.getByText('mayor'));
    expect(screen.getByRole('region', { name: 'hq-mayor pane' })).toBeInTheDocument();
  });

  it('resets pane state when switching from one agent to another', async () => {
    localStorage.setItem('allay-token', 'tok');
    vi.spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ session: 'hq-mayor', pane: 'mayor output', capturedAt: 1 })
      .mockResolvedValueOnce({ session: 'al-witness', pane: 'witness output', capturedAt: 2 });

    render(<App />);
    act(() => {
      capturedOptions!.onMessage({
        type: 'snapshot',
        resource: 'agents',
        snapshot: {
          data: [
            { name: 'mayor', address: 'mayor/', session: 'hq-mayor', role: 'coordinator', rig: null, running: true, state: 'idle', hasWork: false },
            { name: 'witness', address: 'allay/witness', session: 'al-witness', role: 'witness', rig: 'allay', running: true, state: 'idle', hasWork: false },
          ],
          lastSuccessAt: 1,
          lastError: null,
          isStale: false,
        },
      });
    });

    fireEvent.click(screen.getByText('mayor'));
    await screen.findByText('mayor output');

    // getByText('witness') would be ambiguous here: this agent's name
    // and role are both "witness", and AgentsRoster renders the role in
    // a plain cell alongside the name button, so two elements match.
    // Target the name button specifically, matching the click-to-select
    // intent this test exercises.
    fireEvent.click(screen.getByRole('button', { name: 'witness' }));
    // The new panel starts from "Loading…" (a fresh mount), never
    // showing the previous agent's leftover output even momentarily.
    expect(screen.queryByText('mayor output')).not.toBeInTheDocument();
    await screen.findByText('witness output');
  });
});

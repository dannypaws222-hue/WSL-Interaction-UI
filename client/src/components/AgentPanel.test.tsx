import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentPanel } from './AgentPanel';
import * as apiClient from '../api/client';

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the pane on mount and renders it as plain text', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'hello from mayor', capturedAt: 1 });
    render(<AgentPanel session="hq-mayor" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('hello from mayor')).toBeInTheDocument());
    expect(apiClient.apiFetch).toHaveBeenCalledWith('/api/agents/hq-mayor/pane');
  });

  it('renders pane content containing HTML-like text as plain text, not markup', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: '<script>alert(1)</script>', capturedAt: 1 });
    const { container } = render(<AgentPanel session="hq-mayor" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument());
    expect(container.querySelector('script')).toBeNull();
  });

  it('polls again after the interval elapses', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'v1', capturedAt: 1 });
    render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchPane).toHaveBeenCalledTimes(2);
  });

  it('shows an error message when the fetch fails, without throwing', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('502'));
    render(<AgentPanel session="hq-mayor" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('502'));
  });

  it('stops polling once unmounted', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'v1', capturedAt: 1 });
    const { unmount } = render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchPane).toHaveBeenCalledTimes(1);
  });
});

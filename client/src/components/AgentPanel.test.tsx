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

  it('does not overlap requests: the next poll is scheduled only after the previous one settles', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ session: 'hq-mayor', pane: 'v1', capturedAt: 1 });
    render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    // Advancing by less than the interval must not trigger a second call —
    // proves scheduling is chained off the previous settle, not a fixed
    // ticking interval that could pile up requests independent of it.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchPane).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchPane).toHaveBeenCalledTimes(2);
  });

  it('backs off after consecutive failures instead of retrying at a fixed interval forever', async () => {
    const fetchPane = vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('502'));
    render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    // 1st failure -> next delay should double to 2000ms: advancing only
    // 1000ms (the base interval) must NOT trigger a retry yet.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchPane).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchPane).toHaveBeenCalledTimes(2);

    // 2nd consecutive failure -> next delay should double again to 4000ms:
    // advancing only 2000ms must NOT trigger a retry yet.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchPane).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchPane).toHaveBeenCalledTimes(3);
  });

  it('resets to the base poll interval after a success following failures', async () => {
    const fetchPane = vi
      .spyOn(apiClient, 'apiFetch')
      .mockRejectedValueOnce(new Error('502'))
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue({ session: 'hq-mayor', pane: 'recovered', capturedAt: 1 });

    render(<AgentPanel session="hq-mayor" onClose={() => {}} pollIntervalMs={1000} />);
    await waitFor(() => expect(fetchPane).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(2000); // 1st failure -> retry after 2000ms
    expect(fetchPane).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000); // 2nd failure -> retry after 4000ms, this one succeeds
    expect(fetchPane).toHaveBeenCalledTimes(3);
    await screen.findByText('recovered');

    // Back to the base interval: advancing exactly pollIntervalMs (1000ms)
    // triggers the next poll again.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchPane).toHaveBeenCalledTimes(4);
  });
});

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
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
});

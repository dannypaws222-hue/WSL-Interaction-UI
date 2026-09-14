import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveToken, apiFetch, MissingTokenError } from './client';

describe('resolveToken', () => {
  beforeEach(() => localStorage.clear());

  it('stores and returns the token found in the URL query string', () => {
    const location = { search: '?token=abc123' } as Location;
    expect(resolveToken(location)).toBe('abc123');
    expect(localStorage.getItem('allay-token')).toBe('abc123');
  });

  it('falls back to the stored token when the URL has none', () => {
    localStorage.setItem('allay-token', 'stored-token');
    expect(resolveToken({ search: '' } as Location)).toBe('stored-token');
  });

  it('returns null when there is no token anywhere', () => {
    expect(resolveToken({ search: '' } as Location)).toBeNull();
  });
});

describe('apiFetch', () => {
  beforeEach(() => localStorage.clear());

  it('throws MissingTokenError when no token is available', async () => {
    await expect(apiFetch('/api/status/hook')).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('sends the token header against a same-origin relative path and returns parsed JSON', async () => {
    localStorage.setItem('allay-token', 'tok');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 42 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ data: number }>('/api/status/hook');
    expect(result).toEqual({ data: 42 });
    expect(fetchMock).toHaveBeenCalledWith('/api/status/hook', { headers: { 'x-allay-token': 'tok' } });
  });

  it('throws when the response is not ok', async () => {
    localStorage.setItem('allay-token', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(apiFetch('/api/status/hook')).rejects.toThrow('401');
  });
});

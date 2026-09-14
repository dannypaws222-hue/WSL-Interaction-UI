const TOKEN_STORAGE_KEY = 'allay-token';

export function resolveToken(location: Location = window.location): string | null {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) {
    localStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export class MissingTokenError extends Error {
  constructor() {
    super('No Allay auth token found. Open the app once with ?token=<token> from the server startup log.');
  }
}

export async function apiFetch<T>(path: string): Promise<T> {
  const token = resolveToken();
  if (!token) throw new MissingTokenError();

  const res = await fetch(path, { headers: { 'x-allay-token': token } });
  if (!res.ok) throw new Error(`Request to ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

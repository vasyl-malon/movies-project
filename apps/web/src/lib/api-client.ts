export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'ApiError'; }
}
const expiryListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  expiryListeners.add(listener);
  return () => { expiryListeners.delete(listener); };
}
export interface ApiOptions extends Omit<RequestInit, 'body' | 'credentials' | 'cache' | 'redirect' | 'method'> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const pathname = path.split('?')[0];
  if (!pathname?.startsWith('/') || pathname.startsWith('//') || !/^\/[a-zA-Z0-9_./-]+$/.test(pathname) || pathname.split('/').slice(1).some(segment => !segment || segment === '.' || segment === '..') || path.includes('#')) throw new ApiError(0, 'INVALID_PATH', 'Invalid API path');
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the API');
  }
  let data: unknown;
  try { data = [204, 205].includes(response.status) ? undefined : await response.json(); }
  catch (error) { if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error; data = undefined; }
  if (!response.ok) {
    if (response.status === 401) for (const listener of expiryListeners) listener();
    const payload = data as { error?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown } | undefined;
    const code = payload?.error?.code ?? payload?.code;
    const message = payload?.error?.message ?? payload?.message;
    throw new ApiError(response.status, typeof code === 'string' ? code : 'HTTP_ERROR', typeof message === 'string' ? message : 'API request failed');
  }
  if (data === undefined && response.status !== 204 && response.status !== 205) throw new ApiError(response.status, 'INVALID_RESPONSE', 'Invalid API response');
  return data as T;
}

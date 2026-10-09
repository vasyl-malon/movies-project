import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, onSessionExpired } from './api-client';
import { createQueryClient, clearSessionQueries } from './query-client';
import { logout } from '../app/providers';
afterEach(() => vi.unstubAllGlobals());
describe('API client', () => {
  it('uses same-origin cookies and JSON request bodies', async () => {
    let observed: { url: unknown; init?: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => { observed = { url, init }; return Response.json({ id: 1 }); });
    expect(await apiFetch('/auth/sign-in/email', { method: 'POST', body: { email: 'a@example.test' } })).toEqual({ id: 1 });
    expect(observed?.url).toBe('/api/auth/sign-in/email');
    expect(observed?.init?.credentials).toBe('same-origin');
    expect(observed?.init?.body).toBe('{"email":"a@example.test"}');
  });
  it('accepts dotted profile usernames without accepting dot traversal segments', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ username: 'user.name' }));
    expect(await apiFetch('/profiles/user.name')).toEqual({ username: 'user.name' });
    await expect(apiFetch('/profiles/../me')).rejects.toBeInstanceOf(ApiError);
  });
  it.each(['https://evil.example', '//evil.example', '/auth/../admin', '/auth/%2fexample'])('rejects unsafe client path %s before fetching', async path => {
    await expect(apiFetch(path)).rejects.toBeInstanceOf(ApiError);
  });
  it('returns typed errors for non-JSON and structured failures without retrying writes', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return new Response('private stack', { status: 503 }); });
    await expect(apiFetch('/auth/sign-in/email', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 503, code: 'HTTP_ERROR' });
    expect(calls).toBe(1);
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'QUOTA_EXHAUSTED', message: 'Try later' } }, { status: 429 }));
    await expect(apiFetch('/auth/get-session')).rejects.toMatchObject({ status: 429, code: 'QUOTA_EXHAUSTED', message: 'Try later' });
  });
  it('keeps cancellation distinguishable from network failures', async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { init.signal?.throwIfAborted(); });
    await expect(apiFetch('/auth/get-session', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    await expect(apiFetch('/auth/get-session')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
  it('notifies expiry subscribers on 401 and permits unsubscribe', async () => {
    let expired = 0;
    const unsubscribe = onSessionExpired(() => { expired++; });
    vi.stubGlobal('fetch', async () => Response.json({ message: 'Unauthorized' }, { status: 401 }));
    await expect(apiFetch('/auth/get-session')).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(1); unsubscribe();
    await expect(apiFetch('/auth/get-session')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toBe(1);
  });
  it('handles empty successful responses', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect(await apiFetch('/auth/sign-out', { method: 'POST' })).toBeUndefined();
  });
  it('preserves cancellation during response body parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(stream) { controller.abort(); stream.error(new DOMException('Aborted', 'AbortError')); } }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(apiFetch('/auth/get-session', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([200, 503])('logout clears private data when upstream returns %s', async status => {
    const client = createQueryClient(); client.setQueryData(['private'], 'secret');
    vi.stubGlobal('fetch', async () => Response.json({}, { status }));
    await logout(client).catch(() => undefined);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it('creates isolated query clients and cancels/clears private data on logout', async () => {
    const first = createQueryClient(); const second = createQueryClient();
    first.setQueryData(['private', 'entries'], [{ review: 'private' }]);
    expect(second.getQueryData(['private', 'entries'])).toBeUndefined();
    let aborted = false;
    const pending = first.fetchQuery({ queryKey: ['private', 'pending'], queryFn: ({ signal }) => new Promise(resolve => { signal.addEventListener('abort', () => { aborted = true; resolve(null); }); }) }).catch(() => undefined);
    await clearSessionQueries(first); await pending;
    expect(aborted).toBe(true);
    expect(first.getQueryCache().getAll()).toHaveLength(0);
    expect(first.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

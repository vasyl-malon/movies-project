import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { proxyRequest } from '../../lib/api-proxy';

const secret = 'test-proxy-secret-with-at-least-32-characters';
let upstream: Server;
let base: string;
let received: { url?: string; headers: Record<string, unknown>; body: string };
beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const body = (req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString();
    received = { url: req.url, headers: req.headers, body };
    if (req.url?.includes('large-response')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('x'.repeat(2_097_153)); return; }
    if (req.url?.includes('slow-body')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); setTimeout(() => res.end('}'), 200); return; }
    if (req.url?.includes('timeout')) { setTimeout(() => res.end('{}'), 200); return; }
    if (req.url?.includes('non-json')) { res.writeHead(503, { 'Content-Type': 'text/html' }); res.end('<h1>private upstream error</h1>'); return; }
    if (req.url?.includes('redirect')) { res.writeHead(302, { Location: `${base}/api/auth/get-session` }); res.end(); return; }
    if (req.url?.includes('root-location')) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    if (req.url?.includes('external')) { res.writeHead(302, { Location: 'https://evil.example/' }); res.end(); return; }
    if (req.url?.includes('hop-location')) { res.writeHead(302, { Location: 'https://evil.example/', Connection: 'location' }); res.end(); return; }
    res.writeHead(req.headers.cookie ? 200 : 401, { 'Content-Type': 'application/json', 'Set-Cookie': ['first=1; Path=/; HttpOnly', 'second=2; Path=/; HttpOnly'], Connection: 'x-private-hop', 'X-Private-Hop': 'secret', 'X-Forwarded-Host': 'spoof', 'Cache-Control': 'public, max-age=100' });
    res.end(JSON.stringify({ body, authenticated: Boolean(req.headers.cookie) }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
});
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv('API_BASE_URL', base); vi.stubEnv('PROXY_SHARED_SECRET', secret); vi.stubEnv('NODE_ENV', 'test'); });
function request(path = 'auth/sign-in/email', init: RequestInit = {}) {
  return new Request(`http://localhost:3000/api/${path}`, { method: 'POST', headers: { Cookie: 'session=real-cookie', Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"email":"one@example.test"}', ...init });
}
describe('same-origin API proxy', () => {
  it('forwards cookies/body and actual origin while authenticating its client IP', async () => {
    const response = await proxyRequest(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ body: '{"email":"one@example.test"}' });
    expect(received.headers.cookie).toBe('session=real-cookie');
    expect(received.headers.origin).toBe('https://evil.example');
    expect(received.headers['x-tracker-client-ip']).toBe('127.0.0.1');
    const timestamp = received.headers['x-tracker-proxy-time'];
    expect(received.headers['x-tracker-proxy-signature']).toBe(createHmac('sha256', secret).update(`POST\n/api/auth/sign-in/email\n${timestamp}\n127.0.0.1`).digest('hex'));
  });
  it('preserves request content encoding with its unchanged bytes', async () => {
    const body = '{"email":"compressed@example.test"}';
    const response = await proxyRequest(request(undefined, { body: new Uint8Array(gzipSync(body)).buffer, headers: { Cookie: 'session=1', 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } }));
    expect(response.status).toBe(200);
    expect((await response.json()).body).toBe(body);
  });
  it('preserves multiple cookies and prevents shared caching', async () => {
    const response = await proxyRequest(request());
    expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/; HttpOnly', 'second=2; Path=/; HttpOnly']);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-private-hop')).toBeNull();
    expect(response.headers.get('x-forwarded-host')).toBeNull();
    expect(response.headers.get('x-tracker-proxy-signature')).toBeNull();
  });
  it('strips caller forwarding, signature and connection-nominated headers', async () => {
    await proxyRequest(request(undefined, { headers: { Cookie: 'session=1', Connection: 'x-secret, origin', 'X-Secret': 'leak', Origin: 'https://evil.example', 'X-Forwarded-For': '1.2.3.4', 'X-Real-IP': '1.2.3.4', 'X-Tracker-Client-IP': '1.2.3.4', 'X-Tracker-Proxy-Signature': 'fake' } }));
    expect(received.headers['x-secret']).toBeUndefined();
    expect(received.headers['x-forwarded-for']).toBeUndefined();
    expect(received.headers['x-real-ip']).toBeUndefined();
    expect(received.headers.origin).not.toBe('http://localhost:3000');
    expect(received.headers['x-tracker-client-ip']).toBe('127.0.0.1');
  });
  it.each(['https://evil.example', '//evil.example', 'auth/%2f%2fevil.example', 'auth/../admin', 'admin', 'auth/unknown', 'auth/get-session/extra'])('rejects arbitrary destination/path %s', async path => {
    const response = await proxyRequest(request(path));
    expect([400, 404]).toContain(response.status);
  });
  it('rejects unsupported methods', async () => { expect((await proxyRequest(request('auth/get-session', { method: 'PUT' }))).status).toBe(405); });
  it('forwards unauthenticated responses', async () => {
    const response = await proxyRequest(request('auth/get-session', { method: 'GET', body: undefined, headers: {} }));
    expect(response.status).toBe(401);
  });
  it('returns safe JSON for non-JSON upstream failures', async () => {
    const response = await proxyRequest(request('auth/get-session?non-json=1', { method: 'GET', body: undefined }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });
  it('does not follow upstream redirects and rewrites only fixed upstream or frontend destinations', async () => {
    const response = await proxyRequest(request('auth/verify-email?redirect=1', { method: 'GET', body: undefined }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:3000/api/auth/get-session');
    expect((await proxyRequest(request('auth/verify-email?external=1', { method: 'GET', body: undefined }))).status).toBe(502);
  });
  it('preserves Better Auth relative root redirects on the frontend origin', async () => {
    const response = await proxyRequest(request('auth/verify-email?root-location=1', { method: 'GET', body: undefined }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:3000/');
  });
  it('does not restore a Connection-nominated Location header', async () => {
    const response = await proxyRequest(request('auth/verify-email?hop-location=1', { method: 'GET', body: undefined }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBeNull();
  });
  it('bounds upstream waiting and returns structured timeout errors', async () => {
    const response = await proxyRequest(request('auth/get-session?timeout=1', { method: 'GET', body: undefined }), { timeoutMs: 10 });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
  });
  it('bounds response body waiting after headers arrive', async () => {
    expect((await proxyRequest(request('auth/get-session?slow-body=1', { method: 'GET', body: undefined }), { timeoutMs: 10 })).status).toBe(504);
  });
  it('bounds request buffering', async () => {
    expect((await proxyRequest(request(undefined, { body: 'x'.repeat(65_537) }))).status).toBe(413);
  });
  it('bounds response buffering', async () => {
    expect((await proxyRequest(request('auth/get-session?large-response=1', { method: 'GET', body: undefined }))).status).toBe(502);
  });
  it.each([['me', 'PATCH'], ['friends/user-id', 'DELETE'], ['friend-requests', 'POST']])('forwards approved %s %s contract', async (path, method) => {
    expect((await proxyRequest(request(path, { method }))).status).toBe(200);
    expect(received.url).toBe(`/api/${path}`);
  });
  it('forwards profile usernames accepted by the installed auth validator', async () => {
    expect((await proxyRequest(request('profiles/user.name', { method: 'GET', body: undefined }))).status).toBe(200);
  });
  it('returns safe unavailable errors', async () => {
    vi.stubEnv('API_BASE_URL', 'http://127.0.0.1:1');
    expect((await proxyRequest(request())).status).toBe(502);
  });
  it('fails closed for malformed fixed config and missing production IP contract', async () => {
    vi.stubEnv('API_BASE_URL', 'https://user:password@example.test/path');
    expect((await proxyRequest(request())).status).toBe(503);
    vi.stubEnv('API_BASE_URL', base); vi.stubEnv('NODE_ENV', 'production');
    expect((await proxyRequest(request())).status).toBe(503);
  });
  it('trusts exactly one Vercel platform IP only on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    expect((await proxyRequest(request())).status).toBe(503);
    const headers = { Cookie: 'session=1', 'X-Vercel-Forwarded-For': '198.51.100.2' };
    expect((await proxyRequest(request(undefined, { headers }))).status).toBe(200);
    expect(received.headers['x-tracker-client-ip']).toBe('198.51.100.2');
    expect((await proxyRequest(request(undefined, { headers: { ...headers, 'X-Vercel-Forwarded-For': '198.51.100.2, 1.2.3.4' } }))).status).toBe(503);
  });
});

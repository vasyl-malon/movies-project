import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

// Only paths in the approved API contract may reach the fixed upstream.
const routes: [RegExp, readonly string[]][] = [
  [/^auth\/(?:sign-up\/email|sign-in\/email|sign-out|request-password-reset|reset-password|send-verification-email)$/, ['POST']],
  [/^auth\/(?:get-session|verify-email)$/, ['GET']],
  [/^me$/, ['GET', 'PATCH']], [/^profiles\/[a-zA-Z0-9_.]+$/, ['GET']],
  [/^friends$/, ['GET']], [/^friends\/[a-zA-Z0-9_-]+$/, ['DELETE']],
  [/^friend-requests$/, ['GET', 'POST']], [/^friend-requests\/[a-zA-Z0-9_-]+$/, ['DELETE']], [/^friend-requests\/[a-zA-Z0-9_-]+\/accept$/, ['POST']],
  [/^media\/(?:search|imdb\/tt[0-9]+|[a-zA-Z0-9_-]+\/seasons(?:\/[0-9]+)?)$/, ['GET']],
  [/^entries$/, ['POST']], [/^entries\/[a-zA-Z0-9_-]+$/, ['GET', 'PATCH', 'DELETE']],
  [/^users\/[a-zA-Z0-9_-]+\/entries$/, ['GET']], [/^feed$/, ['GET']], [/^community\/(?:media|seasons)\/[a-zA-Z0-9_-]+$/, ['GET']],
];
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'];
function cleanHeaders(input: Headers): Headers {
  const headers = new Headers(input);
  for (const name of input.get('connection')?.split(',') ?? []) headers.delete(name.trim());
  for (const name of [...headers.keys()]) {
    if (hopHeaders.includes(name) || name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-') || name.startsWith('x-vercel-') || name.startsWith('x-tracker-') || name === 'cdn-cache-control' || name === 'vercel-cdn-cache-control') headers.delete(name);
  }
  return headers;
}
function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' } });
}
function configuration(): { base: URL; secret: string } {
  const base = new URL(process.env.API_BASE_URL ?? '');
  const secret = process.env.PROXY_SHARED_SECRET ?? '';
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || secret.trim().length < 32 || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) throw new Error('Invalid proxy configuration');
  return { base, secret };
}
class BodyTooLarge extends Error {}
async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!body) return new ArrayBuffer(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
export async function proxyRequest(request: Request, options: { timeoutMs?: number } = {}): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice('/api/'.length);
  if (!incoming.pathname.startsWith('/api/') || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return failure(400, 'INVALID_PATH', 'Invalid API path');
  const route = routes.find(([pattern]) => pattern.test(path));
  if (!route) return failure(404, 'NOT_FOUND', 'Unknown API path');
  if (!route[1].includes(request.method)) return failure(405, 'METHOD_NOT_ALLOWED', 'Unsupported API method');
  let config: ReturnType<typeof configuration>;
  try { config = configuration(); } catch { return failure(503, 'PROXY_CONFIGURATION', 'API transport is unavailable'); }
  let ip = '127.0.0.1';
  if (process.env.VERCEL === '1') {
    ip = request.headers.get('x-vercel-forwarded-for') ?? '';
    if (!isIP(ip)) return failure(503, 'PROXY_CONFIGURATION', 'Trusted client address is unavailable');
  } else if (process.env.NODE_ENV === 'production') return failure(503, 'PROXY_CONFIGURATION', 'Trusted client address is unavailable');
  const target = new URL(`/api/${path}${incoming.search}`, config.base);
  const headers = cleanHeaders(request.headers);
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  headers.set('x-tracker-client-ip', ip);
  headers.set('x-tracker-proxy-time', timestamp);
  headers.set('x-tracker-proxy-signature', createHmac('sha256', config.secret).update(`${request.method}\n${target.pathname}${target.search}\n${timestamp}\n${ip}`).digest('hex'));
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const signal = AbortSignal.any([request.signal, timeout]);
  let readingRequest = true;
  try {
    const requestBody = ['GET', 'HEAD'].includes(request.method) ? undefined : await readLimited(request.body, 65_536, signal);
    readingRequest = false;
    const response = await fetch(target, { method: request.method, headers, body: requestBody, cache: 'no-store', redirect: 'manual', signal });
    const outgoing = cleanHeaders(response.headers);
    // Node fetch decompresses upstream responses; request bytes retain their encoding.
    outgoing.delete('content-encoding');
    const cookies = outgoing.getSetCookie();
    outgoing.delete('set-cookie');
    for (const cookie of cookies) outgoing.append('set-cookie', cookie);
    outgoing.set('Cache-Control', 'private, no-store');
    outgoing.set('CDN-Cache-Control', 'no-store');
    outgoing.set('Vercel-CDN-Cache-Control', 'no-store');
    const location = outgoing.get('location');
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === config.base.origin) {
        redirect.host = incoming.host; redirect.protocol = incoming.protocol;
      } else if (redirect.origin !== incoming.origin) { await response.body?.cancel(); return failure(502, 'UNSAFE_REDIRECT', 'Invalid API redirect'); }
      outgoing.set('location', redirect.toString());
    }
    const body = await readLimited(response.body, 2_097_152, signal);
    if (response.status >= 400 && !response.headers.get('content-type')?.includes('application/json')) return failure(response.status, 'UPSTREAM_ERROR', 'API request failed');
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: outgoing });
  } catch (error) {
    if (error instanceof BodyTooLarge) return failure(readingRequest ? 413 : 502, readingRequest ? 'REQUEST_TOO_LARGE' : 'UPSTREAM_TOO_LARGE', 'API payload is too large');
    if (timeout.aborted) return failure(504, 'UPSTREAM_TIMEOUT', 'API request timed out');
    if (request.signal.aborted) return failure(499, 'REQUEST_CANCELLED', 'Request cancelled');
    return failure(502, 'UPSTREAM_UNAVAILABLE', 'API is unavailable');
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
interface ProxyRequest { headers: Record<string, string | string[] | undefined>; method: string; originalUrl: string; socket: { remoteAddress?: string }; }
export const PROXY_CONFIG = Symbol('PROXY_CONFIG');
/** Forwarding headers confer no trust; only a fresh authenticated proxy envelope does. */
export function trustedClientIp(request: ProxyRequest, secret?: string, now = Math.floor(Date.now() / 1000)): string {
  const ip = request.headers['x-tracker-client-ip'];
  const timestamp = request.headers['x-tracker-proxy-time'];
  const signature = request.headers['x-tracker-proxy-signature'];
  if (ip === undefined && timestamp === undefined && signature === undefined) return request.socket.remoteAddress ?? 'unknown';
  if (!secret || typeof ip !== 'string' || !isIP(ip) || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 30 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('Invalid proxy authentication');
  const expected = createHmac('sha256', secret).update(`${request.method}\n${request.originalUrl}\n${timestamp}\n${ip}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('Invalid proxy authentication');
  return ip;
}

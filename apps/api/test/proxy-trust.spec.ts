import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { trustedClientIp } from '../src/common/proxy-trust.js';
import { validateEnvironment } from '../src/config.js';
const key = 'proxy-secret-with-at-least-32-characters';
const now = 1_800_000_000;
function headers(ip = '198.51.100.4', path = '/api/auth/sign-in/email?x=1', timestamp = now) {
  return { 'x-tracker-client-ip': ip, 'x-tracker-proxy-time': `${timestamp}`, 'x-tracker-proxy-signature': createHmac('sha256', key).update(`POST\n${path}\n${timestamp}\n${ip}`).digest('hex') };
}
describe('authenticated proxy IP boundary', () => {
  it('uses socket IP for direct requests and ignores spoofed forwarding', () => {
    expect(trustedClientIp({ headers: { 'x-forwarded-for': '198.51.100.9' }, method: 'POST', originalUrl: '/api/auth/sign-in/email', socket: { remoteAddress: '127.0.0.1' } }, key, now)).toBe('127.0.0.1');
  });
  it('accepts fresh signed exact method/path/IP', () => {
    expect(trustedClientIp({ headers: headers(), method: 'POST', originalUrl: '/api/auth/sign-in/email?x=1', socket: {} }, key, now)).toBe('198.51.100.4');
  });
  it.each([
    { label: 'wrong path', path: '/api/auth/sign-up/email', method: 'POST', head: headers() },
    { label: 'wrong method', path: '/api/auth/sign-in/email?x=1', method: 'GET', head: headers() },
    { label: 'stale', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: headers(undefined, undefined, now - 31) },
    { label: 'future', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: headers(undefined, undefined, now + 31) },
    { label: 'invalid IP', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: headers('evil') },
    { label: 'IP list', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: headers('198.51.100.4, 1.2.3.4') },
    { label: 'missing signature', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: { 'x-tracker-client-ip': '198.51.100.4' } },
    { label: 'invalid signature', path: '/api/auth/sign-in/email?x=1', method: 'POST', head: { ...headers(), 'x-tracker-proxy-signature': 'f'.repeat(64) } },
  ])('rejects marked proxy requests: $label', ({ path, method, head }) => {
    expect(() => trustedClientIp({ headers: head, method, originalUrl: path, socket: {} }, key, now)).toThrow();
  });
  it('rejects signed requests if no proxy secret configured', () => {
    expect(() => trustedClientIp({ headers: headers(), method: 'POST', originalUrl: '/api/auth/sign-in/email?x=1', socket: {} }, undefined, now)).toThrow();
  });
  it('validates optional server-only shared secret', () => {
    expect(() => validateEnvironment({ DATABASE_URL: 'postgresql://localhost/tracker_test', BETTER_AUTH_SECRET: key, OMDB_API_KEY: 'test', FRONTEND_ORIGIN: 'http://localhost:3000', PROXY_SHARED_SECRET: 'short' })).toThrow('PROXY_SHARED_SECRET');
  });
});

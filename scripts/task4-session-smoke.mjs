import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const origin of [state.frontendOrigin, state.apiOrigin, state.mailOrigin]) {
  const url = new URL(origin);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:');
}
assert.ok(new URL(state.smokeDatabaseUrl).pathname.endsWith('_test'));
const jar = new Map();
async function call(path, options = {}) {
  const response = await fetch(`${state.frontendOrigin}/api/auth/${path}`, {
    ...options, redirect: 'manual', headers: { Origin: state.frontendOrigin, Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), 'Content-Type': 'application/json', ...options.headers },
  });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-tracker-proxy-signature'), null);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]; const separator = pair.indexOf('=');
    if (/max-age=0/i.test(cookie)) jar.delete(pair.slice(0, separator));
    else jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}
const email = `${randomUUID()}@example.test`;
const password = 'isolated-password-1234';
assert.equal(await (await call('get-session')).json(), null);
const signup = await call('sign-up/email', { method: 'POST', body: JSON.stringify({ email, password, name: 'Smoke User', username: `smoke${randomUUID().replaceAll('-', '').slice(0, 16)}` }) });
assert.equal(signup.status, 200);
assert.equal((await call('sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) })).status, 403);
const messages = await (await fetch(`${state.mailOrigin}/api/v1/messages`)).json();
const mail = messages.messages.find(item => item.To.some(to => to.Address === email) && item.Subject.includes('Verify'));
assert.ok(mail, 'Verification delivered only to local inbox');
const content = await (await fetch(`${state.mailOrigin}/api/v1/message/${mail.ID}`)).json();
const verification = new URL(content.Text.match(/https?:\/\/\S+/)[0]);
assert.equal(verification.origin, state.frontendOrigin);
const verified = await call(verification.pathname.slice('/api/auth/'.length) + verification.search);
assert.equal(verified.status, 302);
assert.equal(new URL(verified.headers.get('location'), state.frontendOrigin).origin, state.frontendOrigin);
const login = await call('sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
assert.equal(login.status, 200);
assert.ok(login.headers.getSetCookie().some(cookie => /HttpOnly/i.test(cookie)), 'Next preserves actual session cookie attributes');
const oldCookies = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
const session = await (await call('get-session')).json();
assert.equal(session.user.email, email);
assert.equal((await call('sign-out', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example', 'X-Forwarded-For': '198.51.100.1', 'X-Tracker-Client-IP': '198.51.100.1', 'X-Tracker-Proxy-Signature': 'fake' } })).status, 403);
assert.equal((await (await call('get-session')).json()).user.id, session.user.id);
assert.equal((await call('sign-out', { method: 'POST', body: '{}' })).status, 200);
assert.equal(await (await call('get-session', { headers: { Cookie: oldCookies } })).json(), null, 'Old cookie cannot resurrect revoked database session');
// Check the real backend rejects caller-generated proxy metadata independently.
const forged = await fetch(`${state.apiOrigin}/api/auth/sign-in/email`, { method: 'POST', headers: { Origin: state.frontendOrigin, 'Content-Type': 'application/json', 'X-Tracker-Client-IP': '198.51.100.1', 'X-Tracker-Proxy-Time': `${Math.floor(Date.now() / 1000)}`, 'X-Tracker-Proxy-Signature': 'f'.repeat(64) }, body: JSON.stringify({ email, password }) });
assert.equal(forged.status, 403);
// Distinct authenticated proxy IPs do not consume a shared socket bucket.
const proxySecret = 'isolated-task4-proxy-secret-at-least-32-characters';
// Fresh documentation-range IPv6 addresses avoid quota state from earlier invocations.
const signedIps = Array.from({ length: 2 }, () => `2001:db8:${randomUUID().replaceAll('-', '').slice(0, 24).match(/.{4}/g).join(':')}`);
for (const ip of signedIps) {
  for (let attempt = 0; attempt < 11; attempt++) {
    const time = `${Math.floor(Date.now() / 1000)}`;
    const path = '/api/auth/sign-in/email';
    const signature = createHmac('sha256', proxySecret).update(`POST\n${path}\n${time}\n${ip}`).digest('hex');
    const response = await fetch(`${state.apiOrigin}${path}`, { method: 'POST', headers: { Origin: state.frontendOrigin, 'Content-Type': 'application/json', 'X-Tracker-Client-IP': ip, 'X-Tracker-Proxy-Time': time, 'X-Tracker-Proxy-Signature': signature }, body: JSON.stringify({ email: `absent-${randomUUID()}@example.test`, password }) });
    assert.equal(response.status, attempt === 10 ? 429 : 401, 'Persistent auth quota applies per signed client IP');
  }
}
console.info('PASS genuine Next→Nest→PostgreSQL/Mailpit: registration body, verification redirect, HttpOnly session cookie, fresh session GET, hostile Origin rejection, signout and old-cookie revocation, forged proxy rejection, independent signed client-IP quotas.');

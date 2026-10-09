import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, cpSync, mkdirSync, symlinkSync, openSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.ok(state.directory.startsWith('/private/tmp/tracker-task4-'));
const project = `${state.directory}/header-web`;
mkdirSync(project, { recursive: true });
cpSync(`${root}/apps/web/src`, `${project}/src`, { recursive: true });
for (const file of ['package.json', 'tsconfig.json', 'next.config.ts']) cpSync(`${root}/apps/web/${file}`, `${project}/${file}`);
if (!existsSync(`${project}/node_modules`)) symlinkSync(`${state.directory}/web/node_modules`, `${project}/node_modules`, 'dir');
let observedOrigin;
let observedSpoof;
let followed = 0;
const server = createServer((request, response) => {
  if (request.url === '/redirect-target') followed++;
  observedOrigin = request.headers.origin;
  observedSpoof = request.headers['x-forwarded-for'];
  if (request.url?.includes('external')) { response.writeHead(302, { Location: 'https://evil.example/' }); response.end(); return; }
  if (request.url?.includes('redirect')) { response.writeHead(302, { Location: '/redirect-target' }); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['one=1; Path=/; HttpOnly', 'two=2; Path=/; HttpOnly'], Connection: 'x-hop', 'X-Hop': 'private', 'X-Tracker-Proxy-Signature': 'private-signature', 'Cache-Control': 'public, max-age=100' });
  response.end('{}');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const upstreamPort = server.address().port;
const reservation = createServer();
await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
const port = reservation.address().port;
await new Promise(resolveClose => reservation.close(resolveClose));
const origin = `http://localhost:${port}`;
const log = openSync(`${state.directory}/header-next.log`, 'a');
const child = spawn(process.execPath, [`${project}/node_modules/next/dist/bin/next`, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', `${port}`], { cwd: project, detached: true, stdio: ['ignore', log, log], env: { PATH: process.env.PATH, HOME: state.directory, TMPDIR: state.directory, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', API_BASE_URL: `http://127.0.0.1:${upstreamPort}`, PROXY_SHARED_SECRET: 'isolated-header-secret-at-least-32-characters' } });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Wait for isolated Next startup. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  assert.ok(ready, 'Header smoke Next becomes ready');
  const response = await fetch(`${origin}/api/auth/get-session`, { headers: { Origin: 'https://evil.example', 'X-Forwarded-For': '198.51.100.1' } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), ['one=1; Path=/; HttpOnly', 'two=2; Path=/; HttpOnly']);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-hop'), null);
  assert.equal(response.headers.get('x-tracker-proxy-signature'), null);
  assert.equal(observedOrigin, 'https://evil.example');
  assert.equal(observedSpoof, undefined);
  const redirect = await fetch(`${origin}/api/auth/verify-email?redirect=1`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), `${origin}/redirect-target`);
  assert.equal(followed, 0);
  const external = await fetch(`${origin}/api/auth/verify-email?external=1`, { redirect: 'manual' });
  assert.equal(external.status, 502);
  assert.equal((await external.json()).error.code, 'UNSAFE_REDIRECT');
  console.info('PASS real Next header smoke: separate Set-Cookie headers, no shared cache, stripped hop/spoof/signature headers, unchanged hostile Origin, manual same-origin redirect rewriting, blocked external redirect.');
} finally {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  await new Promise(resolveClose => server.close(resolveClose));
}

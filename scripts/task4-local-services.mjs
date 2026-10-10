import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, writeFileSync, readFileSync, cpSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupServices, processIdentity } from './task4-cleanup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgBin = process.env.PG_BIN_DIR ?? '/opt/homebrew/opt/postgresql@14/bin';
if (process.argv[2] === 'cleanup') {
  await cleanupServices(process.argv[3] ?? '');
} else {
  const mailpit = process.env.MAILPIT_BIN ?? '/private/tmp/tracker-mailpit/mailpit';
  if (!existsSync(`${pgBin}/initdb`) || !existsSync(mailpit)) throw new Error('Set PG_BIN_DIR and MAILPIT_BIN to installed local PostgreSQL and Mailpit');
  const directory = mkdtempSync('/private/tmp/tracker-task4-');
  // An exact source snapshot gives Next its own dev lock/cache and no user env files.
  const webDirectory = `${directory}/web`;
  mkdirSync(webDirectory);
  cpSync(`${root}/apps/web/src`, `${webDirectory}/src`, { recursive: true });
  for (const file of ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs']) cpSync(`${root}/apps/web/${file}`, `${webDirectory}/${file}`);
  const modules = `${webDirectory}/node_modules`;
  mkdirSync(modules);
  for (const name of readdirSync(`${root}/apps/web/node_modules`).filter(name => !name.startsWith('.'))) {
    if (name.startsWith('@')) {
      mkdirSync(`${modules}/${name}`);
      for (const child of readdirSync(`${root}/apps/web/node_modules/${name}`)) symlinkSync(`${root}/apps/web/node_modules/${name}/${child}`, `${modules}/${name}/${child}`, 'dir');
    } else symlinkSync(`${root}/apps/web/node_modules/${name}`, `${modules}/${name}`, 'dir');
  }
  for (const name of ['typescript', '@types/node']) symlinkSync(`${root}/node_modules/${name}`, `${modules}/${name}`, 'dir');
  const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development' };
  async function freePort() {
    const server = createServer();
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const port = server.address().port;
    await new Promise(resolveClose => server.close(resolveClose));
    return port;
  }
  const allocated = new Set();
  async function uniquePort() { let port; do { port = await freePort(); } while (allocated.has(port)); allocated.add(port); return port; }
  const databasePort = await uniquePort(); const smtpPort = await uniquePort(); const mailPort = await uniquePort(); const apiPort = await uniquePort(); const webPort = await uniquePort();
  const testDatabaseUrl = `postgresql://tracker@127.0.0.1:${databasePort}/tracker_task4_test`;
  const smokeDatabaseUrl = `postgresql://tracker@127.0.0.1:${databasePort}/tracker_task4_smoke_test`;
  const frontendOrigin = `http://localhost:${webPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const mailOrigin = `http://127.0.0.1:${mailPort}`;
  const proxySecret = 'isolated-task4-proxy-secret-at-least-32-characters';
  const pids = [];
  const state = { directory, pgBin, pids, processes: [], postgres: null, databasePort, smtpPort, testDatabaseUrl, smokeDatabaseUrl, frontendOrigin, apiOrigin, mailOrigin };
  const manifest = `${directory}/services.json`;
  const save = () => writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
  save();
  function run(command, args, extra = {}) {
    const result = spawnSync(command, args, { cwd: root, env: { ...env, DATABASE_URL: smokeDatabaseUrl, ...extra }, encoding: 'utf8' });
    writeFileSync(`${directory}/setup.log`, (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'a' });
    if (result.status !== 0) throw new Error(`Isolated setup command failed: ${command}; see ${directory}/setup.log`);
  }
  function start(command, args, name, extra = {}, cwd = root) {
    const log = openSync(`${directory}/${name}.log`, 'a');
    const child = spawn(command, args, { cwd, env: { ...env, ...extra }, detached: true, stdio: ['ignore', log, log] });
    child.unref(); pids.push(child.pid);
    const identity = processIdentity(child.pid);
    if (!identity || identity.pgid !== child.pid || !identity.command.includes(directory)) throw new Error('Cannot establish isolated service ownership');
    state.processes.push(identity); save();
  }
  async function ready(url) {
    for (let attempts = 0; attempts < 120; attempts++) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Wait for local startup. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    throw new Error('Isolated service did not become ready; consult logs');
  }
  try {
    run(`${pgBin}/initdb`, ['-D', `${directory}/pg`, '--auth=trust', '--username=tracker']);
    run(`${pgBin}/pg_ctl`, ['-D', `${directory}/pg`, '-l', `${directory}/postgres.log`, '-o', `-h 127.0.0.1 -p ${databasePort}`, 'start']);
    state.postgres = processIdentity(Number(readFileSync(`${directory}/pg/postmaster.pid`, 'utf8').split('\n')[0]));
    if (!state.postgres?.command.includes(`${directory}/pg`)) throw new Error('Cannot establish isolated PostgreSQL ownership');
    save();
    for (const name of ['tracker_task4_test', 'tracker_task4_smoke_test']) run(`${pgBin}/createdb`, ['-h', '127.0.0.1', '-p', `${databasePort}`, '-U', 'tracker', name]);
    run('pnpm', ['--filter', '@tracker/api', 'build']);
    for (const url of [testDatabaseUrl, smokeDatabaseUrl]) run('pnpm', ['--filter', '@tracker/api', 'exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: url });
    start(mailpit, ['--disable-version-check', '--smtp-disable-rdns', '--database', `${directory}/mailpit.db`, '--listen', `127.0.0.1:${mailPort}`, '--smtp', `127.0.0.1:${smtpPort}`], 'mailpit');
    start(process.execPath, [`${root}/scripts/task4-api-server.mjs`, `--task4-directory=${directory}`], 'api', { DATABASE_URL: smokeDatabaseUrl, BETTER_AUTH_SECRET: 'isolated-task4-auth-secret-at-least-32-characters', OMDB_API_KEY: 'unused-test-placeholder', FRONTEND_ORIGIN: frontendOrigin, BETTER_AUTH_URL: frontendOrigin, PROXY_SHARED_SECRET: proxySecret, PORT: `${apiPort}`, SMTP_PORT: `${smtpPort}`, ...(process.env.TRACKER_E2E_OMDB_FIXTURES === '1' ? { TRACKER_E2E_OMDB_FIXTURES: '1' } : {}) });
    start(process.execPath, [`${webDirectory}/node_modules/next/dist/bin/next`, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', `${webPort}`], 'next', { API_BASE_URL: apiOrigin, PROXY_SHARED_SECRET: proxySecret }, webDirectory);
    await ready(`${mailOrigin}/api/v1/messages`); await ready(`${apiOrigin}/health`); await ready(frontendOrigin);
    console.info(`Isolated services ready. Manifest: ${manifest}`);
    console.info('Services remain running for review. Clean up with node scripts/task4-local-services.mjs cleanup <manifest>.');
  } catch (error) {
    console.error(error.message);
    try { await cleanupServices(manifest); } catch (cleanupError) { console.error(cleanupError.message); }
    process.exitCode = 1;
  }
}

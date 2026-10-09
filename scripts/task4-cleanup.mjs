import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Invalid recorded process ID');
  const result = spawnSync('/bin/ps', ['-p', `${pid}`, '-o', 'stat=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
  if (result.status !== 0) throw new Error('Cannot inspect recorded process safely');
  const match = result.stdout.trim().match(/^(\S+)\s+(\d+)\s+(.{24})\s+(.+)$/);
  if (!match) throw new Error('Cannot parse recorded process identity');
  if (match[1].startsWith('Z')) return null;
  return { pid, pgid: Number(match[2]), startedAt: match[3], command: match[4] };
}
function sameIdentity(expected, actual) {
  return actual && expected.pid === actual.pid && expected.pgid === actual.pgid && expected.startedAt === actual.startedAt && expected.command === actual.command;
}
function verify(expected, detached) {
  if (!expected || typeof expected.command !== 'string' || typeof expected.startedAt !== 'string' || !Number.isInteger(expected.pgid) || (detached && expected.pgid !== expected.pid)) throw new Error('Missing or invalid recorded process identity');
  const actual = processIdentity(expected.pid);
  if (actual && !sameIdentity(expected, actual)) throw new Error(`Process identity mismatch for PID ${expected.pid}; refusing to signal`);
  return actual;
}
async function waitStopped(identity) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!sameIdentity(identity, processIdentity(identity.pid))) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error(`Recorded process ${identity.pid} did not stop; manifest remains uncleaned`);
}
export async function cleanupServices(manifest) {
  const file = resolve(manifest);
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof state.directory !== 'string' || !state.directory.startsWith('/private/tmp/tracker-task4-') || file !== `${state.directory}/services.json`) throw new Error('Expected an isolated Task 4 service manifest');
  if (state.cleaned === true) { console.info('Isolated services already cleaned; no processes signaled.'); return; }
  if (!Array.isArray(state.processes)) throw new Error('Manifest lacks process identities; refusing legacy PID-only cleanup');
  const pidFile = `${state.directory}/pg/postmaster.pid`;
  const postgresPid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').split('\n')[0]) : null;
  if (postgresPid && state.postgres?.pid !== postgresPid) throw new Error('PostgreSQL PID file does not match its recorded identity');
  // Preflight the entire set before any side effect, then recheck just before each signal.
  for (const identity of state.processes) verify(identity, true);
  const postgres = state.postgres ? verify(state.postgres, false) : null;
  if (postgres && !postgresPid) throw new Error('Running recorded PostgreSQL lacks its matching PID file');
  for (const identity of state.processes) {
    if (verify(identity, true)) {
      try { process.kill(-identity.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      await waitStopped(identity);
    }
  }
  if (postgres && verify(state.postgres, false)) {
    if (Number(readFileSync(pidFile, 'utf8').split('\n')[0]) !== state.postgres.pid) throw new Error('PostgreSQL identity changed during cleanup');
    const stopped = spawnSync(`${state.pgBin}/pg_ctl`, ['-D', `${state.directory}/pg`, '-m', 'fast', 'stop'], { stdio: 'inherit' });
    if (stopped.status !== 0) throw new Error('Recorded PostgreSQL did not stop');
  }
  state.cleaned = true;
  state.cleanedAt = new Date().toISOString();
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  console.info('Verified isolated services cleaned.');
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';

const cleanupScript = resolve('scripts/task4-local-services.mjs');
function identity(pid) {
  const result = spawnSync('/bin/ps', ['-p', `${pid}`, '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
  const match = result.stdout.trim().match(/^(\d+)\s+(.{24})\s+(.+)$/);
  assert.ok(match, 'Harmless child identity is observable');
  return { pid, pgid: Number(match[1]), startedAt: match[2], command: match[3] };
}
async function fixture() {
  const directory = mkdtempSync('/private/tmp/tracker-task4-cleanup-');
  const file = `${directory}/worker.mjs`;
  writeFileSync(file, `import fs from 'node:fs'; fs.writeFileSync('${directory}/ready','ready'); process.on('SIGTERM',()=>{fs.writeFileSync('${directory}/stopped','stopped');process.exit(0);});setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [file], { detached: true, stdio: 'ignore' });
  await once(child, 'spawn');
  for (let attempt = 0; !existsSync(`${directory}/ready`) && attempt < 100; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 10));
  assert.ok(existsSync(`${directory}/ready`));
  const processIdentity = identity(child.pid);
  const manifest = `${directory}/services.json`;
  const state = { directory, pgBin: directory, pids: [child.pid], processes: [processIdentity], postgres: null };
  const save = () => writeFileSync(manifest, JSON.stringify(state));
  save();
  const run = () => spawnSync(process.execPath, [cleanupScript, 'cleanup', manifest], { encoding: 'utf8' });
  const finish = async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } };
  return { directory, child, state, save, run, finish, manifest };
}
for (const field of ['startedAt', 'command', 'pgid']) {
  test(`refuses mismatched ${field} without signaling the harmless child`, async () => {
    const f = await fixture();
    try {
      f.state.processes[0][field] = field === 'pgid' ? 1 : `${f.state.processes[0][field]}-mismatch`;
      f.save();
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(`${f.directory}/stopped`), false, 'Mismatched identity was not signaled');
      process.kill(f.child.pid, 0);
    } finally { await f.finish(); }
  });
}
test('matching cleanup stops its own child and repeated cleanup is a safe no-op', async () => {
  const f = await fixture();
  try {
    const exited = once(f.child, 'exit');
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    await exited;
    assert.ok(existsSync(`${f.directory}/stopped`));
    assert.equal(JSON.parse(readFileSync(f.manifest)).cleaned, true);
    const second = f.run();
    assert.equal(second.status, 0, second.stderr);
  } finally { await f.finish(); }
});
test('an already absent recorded process is safe to clean', async () => {
  const f = await fixture();
  await f.finish();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.manifest)).cleaned, true);
});
test('a legacy PID-only manifest is refused without signaling its child', async () => {
  const f = await fixture();
  try {
    delete f.state.processes; f.save();
    assert.notEqual(f.run().status, 0);
    assert.equal(existsSync(`${f.directory}/stopped`), false);
  } finally { await f.finish(); }
});
test('preflights all identities before stopping any matching service', async () => {
  const first = await fixture(); const second = await fixture();
  try {
    first.state.processes.push({ ...second.state.processes[0], command: 'mismatched-command' });
    first.save();
    assert.notEqual(first.run().status, 0);
    assert.equal(existsSync(`${first.directory}/stopped`), false);
    assert.equal(existsSync(`${second.directory}/stopped`), false);
  } finally { await first.finish(); await second.finish(); }
});
test('rejects mismatched PostgreSQL master identity before invoking pg_ctl', async () => {
  const f = await fixture();
  try {
    mkdirSync(`${f.directory}/pg`);
    writeFileSync(`${f.directory}/pg/postmaster.pid`, `${f.child.pid}\n`);
    f.state.postgres = { ...f.state.processes[0], startedAt: 'mismatched-start-time' };
    f.state.processes = []; f.save();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Process identity mismatch/);
    assert.equal(existsSync(`${f.directory}/stopped`), false);
  } finally { await f.finish(); }
});

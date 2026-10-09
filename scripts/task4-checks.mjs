import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const database = new URL(state.testDatabaseUrl);
if (database.hostname !== '127.0.0.1' || !database.pathname.endsWith('_test')) throw new Error('Expected isolated loopback _test database');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { PATH: process.env.PATH, HOME: state.directory, TMPDIR: state.directory, NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: state.testDatabaseUrl, TEST_DATABASE_URL: state.testDatabaseUrl, TEST_MAILPIT_URL: state.mailOrigin, TEST_SMTP_PORT: `${state.smtpPort}` };
for (const command of ['test', 'typecheck', 'lint', 'build']) {
  const result = spawnSync('pnpm', [command], { cwd: root, env, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(`${state.directory}/${command}.log`, output);
  console.info(output);
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const state = JSON.parse(readFileSync(process.env.E2E_MANIFEST!, 'utf8')) as { frontendOrigin: string; mailOrigin: string; smokeDatabaseUrl: string; pgBin: string; directory: string };
for (const origin of [state.frontendOrigin, state.mailOrigin]) {
  const url = new URL(origin);
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Loopback-only browser and inbox origins required');
}
const database = new URL(state.smokeDatabaseUrl);
if (!['localhost','127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test') || !state.directory.startsWith('/private/tmp/tracker-task4-')) throw new Error('Isolated test database required');
export function sql(query: string) {
  const identity = spawnSync(`${state.pgBin}/psql`, [state.smokeDatabaseUrl, '-Atc', 'SELECT current_database()'], { encoding: 'utf8' });
  if (identity.status !== 0 || identity.stdout.trim() !== database.pathname.slice(1)) throw new Error('Test database identity mismatch');
  const result = spawnSync(`${state.pgBin}/psql`, [state.smokeDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
export const test = base.extend<{ account: { email: string; username: string; password: string }; mailLink: (email: string, subject: string) => Promise<string> }>({
  account: async ({ page }, provide) => { void page; const id = randomUUID().replaceAll('-',''); await provide({ email: `${id}@example.test`, username: `cine_${id.slice(0,16)}`, password: 'Cinema-password-1234' }); },
  mailLink: async ({ request }, provide) => { await provide(async (email, subject) => {
    let link = '';
    await expect.poll(async () => {
      const inbox = await (await request.get(`${state.mailOrigin}/api/v1/messages`)).json();
      const message = inbox.messages.find((item: { To: { Address: string }[]; Subject: string }) => item.To.some(to => to.Address === email) && item.Subject.includes(subject));
      if (!message) return false;
      const content = await (await request.get(`${state.mailOrigin}/api/v1/message/${message.ID}`)).json();
      link = content.Text.match(/https?:\/\/\S+/)[0];
      expect(new URL(link).origin).toBe(state.frontendOrigin); return true;
    }).toBe(true); return link;
  }); },
});
export { expect };

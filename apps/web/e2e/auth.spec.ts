import { test, expect, sql } from './fixtures';
test.beforeEach(() => { sql('DELETE FROM "RateLimit"'); });
test('registration requires email verification; sign in, edit profile, theme and sign out', async ({ page, account, mailLink }) => {
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Start your story' })).toBeVisible();
  await page.getByLabel('Display name').fill('Cinema Lover');
  await page.getByLabel('Username', { exact: true }).fill(account.username.toUpperCase());
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/verify-email/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Verify');
  await page.goto(await mailLink(account.email, 'Verify'));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-1234');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Email or password');
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/settings/);
  await page.getByLabel('Display name').fill('Director');
  await page.getByRole('radio', { name: 'Popcorn' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Director');
  await expect(page.getByRole('radio', { name: 'Popcorn' })).toBeChecked();
  await page.getByRole('button', { name: 'Use light theme' }).first().click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goBack();
  await expect(page.getByLabel('Display name')).not.toBeVisible();
});

async function register(page: import('@playwright/test').Page, account: { email: string; username: string; password: string }) {
  await page.goto('/sign-up'); await page.getByLabel('Display name').fill('Private Cinema Name');
  await page.getByLabel('Username', { exact: true }).fill(account.username); await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'Create account' }).click(); await expect(page).toHaveURL(/verify-email/);
}
async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/sign-in'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page).toHaveURL(/settings/); await expect(page.getByLabel('Display name')).toBeVisible();
}
test('expired verification link recovers through a real inbox resend', async ({ page, account, mailLink }) => {
  const { createHmac } = await import('node:crypto');
  await register(page, account);
  const link = new URL(await mailLink(account.email,'Verify'));
  const token = link.searchParams.get('token')!.split('.');
  const payload = JSON.parse(Buffer.from(token[1], 'base64url').toString()); payload.exp = Math.floor(Date.now()/1000)-60;
  token[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  token[2] = createHmac('sha256', 'isolated-task4-auth-secret-at-least-32-characters').update(`${token[0]}.${token[1]}`).digest('base64url');
  link.searchParams.set('token',token.join('.')); await page.goto(link.href);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByRole('button', { name: 'Send new verification link' }).click();
  await expect(page.getByRole('status')).toContainText('new link');
  await page.goto(await mailLink(account.email,'Verify'));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await signIn(page, account.email, account.password);
});
test('reset links expire, recover, work once and revoke the old session', async ({ page, browser, account, mailLink }) => {
  await register(page,account); await page.goto(await mailLink(account.email,'Verify')); await signIn(page,account.email,account.password);
  const oldContext = await browser.newContext({ storageState: await page.context().storageState() }); const oldPage = await oldContext.newPage();
  await oldPage.goto('/settings'); await expect(oldPage.getByLabel('Display name')).toHaveValue('Private Cinema Name');
  await page.goto('/forgot-password'); await page.getByLabel('Email', { exact: true }).fill(account.email); await page.getByRole('button', { name: 'Send reset link' }).click(); await expect(page.getByRole('status')).toContainText('If an account exists');
  const expired = await mailLink(account.email,'Reset');
  sql('UPDATE "Verification" SET "expiresAt" = TIMESTAMP \'2000-01-01 00:00:00\'');
  await page.goto(expired); await expect(page.getByRole('heading', { name: 'Request a fresh link' })).toBeVisible();
  await page.getByRole('link', { name: 'Request a fresh reset link' }).click();
  await page.getByLabel('Email', { exact: true }).fill(account.email); await page.getByRole('button', { name: 'Send reset link' }).click(); await expect(page.getByRole('status')).toContainText('If an account exists');
  const reset = await mailLink(account.email,'Reset'); await page.goto(reset);
  await page.getByLabel('New password').fill('Updated-password-1234'); await page.getByRole('button', { name: 'Update password' }).click(); await expect(page.getByRole('status')).toContainText('Password updated');
  await oldPage.reload(); await expect(oldPage).toHaveURL(/sign-in/); await expect(oldPage.getByLabel('Display name')).not.toBeVisible();
  await page.goto(reset); await expect(page.getByRole('heading', { name: 'Request a fresh link' })).toBeVisible();
  sql('DELETE FROM "RateLimit"'); await signIn(page,account.email,'Updated-password-1234'); await oldContext.close();
});
test('fresh session checks hide private children, expire safely and reject open redirects', async ({ page, account, mailLink }) => {
  await register(page, account); await page.goto(await mailLink(account.email,'Verify')); await signIn(page,account.email,account.password);
  let release!: () => void; const hold = new Promise<void>(resolve => { release=resolve; });
  await page.route('**/api/auth/get-session**', async route => { await hold; await route.continue(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('Checking'); await expect(page.getByLabel('Display name')).not.toBeVisible(); await expect(page.getByText('Private Cinema Name', { exact:true })).not.toBeVisible();
  release(); await expect(page.getByLabel('Display name')).toBeVisible(); await page.unroute('**/api/auth/get-session**');
  sql('UPDATE "Session" SET "expiresAt" = TIMESTAMP \'2000-01-01 00:00:00\''); await page.reload();
  await expect(page).toHaveURL(/sign-in/); await expect(page.getByText('Private Cinema Name', { exact: true })).not.toBeVisible();
  await page.goto('/sign-in?next=https%3A%2F%2Fevil.example'); await page.getByLabel('Email', { exact:true }).fill(account.email); await page.getByLabel('Password', { exact:true }).fill(account.password); await page.getByRole('button', { name: 'Sign in', exact:true }).click(); await expect(page).toHaveURL(/settings/);
});
test('401 hides profile and failed logout closes private UI', async ({ page, account, mailLink }) => {
  await register(page,account); await page.goto(await mailLink(account.email,'Verify')); await signIn(page,account.email,account.password);
  await page.route('**/api/me', route => route.fulfill({ status:401, contentType:'application/json', body:'{"message":"Unauthorized"}' }));
  await page.getByLabel('Display name').fill('Revoked change'); await page.getByRole('button', { name:'Save profile' }).click();
  await expect(page).toHaveURL(/sign-in/); await expect(page.getByText('Private Cinema Name', { exact:true })).not.toBeVisible();
  await page.unroute('**/api/me'); await signIn(page,account.email,account.password);
  let release!: () => void; let responseReady!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { responseReady = resolve; });
  await page.route('**/api/me', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    const response = await route.fetch(); responseReady(); await held; await route.fulfill({ response });
  });
  await page.getByLabel('Display name').fill('Late private response');
  await page.getByRole('button', { name:'Save profile' }).click(); await ready;
  await page.route('**/api/auth/sign-out', route => route.fulfill({ status:503, contentType:'application/json', body:'{}' }));
  await page.getByRole('button', { name:'Sign out' }).click(); await expect(page).toHaveURL(/sign-in/);
  release(); await expect(page.getByText('Late private response', { exact:true })).not.toBeVisible();
  await page.goBack(); await expect(page.getByLabel('Display name')).not.toBeVisible();
});
test('legacy usernames are preserved and canonical edits validated; capture responsive views', async ({ page, account, mailLink }, testInfo) => {
  const errors: string[]=[]; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if(message.type()==='error') errors.push(message.text()); });
  await register(page,account); await page.goto(await mailLink(account.email,'Verify'));
  sql(`UPDATE "User" SET username = 'legacy.${account.username.slice(0,20)}' WHERE email = '${account.email}'`); await signIn(page,account.email,account.password);
  await page.getByLabel('Display name').fill('Cinema Enthusiast'); await page.getByRole('button', { name:'Save profile' }).click(); await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.getByLabel('Username', { exact:true }).fill('invalid.name'); await page.getByRole('button', { name:'Save profile' }).click(); await expect(page.locator('p[role=alert]')).toContainText('letters, numbers');
  await page.getByLabel('Username', { exact:true }).fill(account.username.toUpperCase()); await page.getByRole('button', { name:'Save profile' }).click(); await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.setViewportSize({width:1440,height:1000}); await page.evaluate(() => { window.scrollTo(0,0); (document.activeElement as HTMLElement)?.blur(); }); await expect(page.locator('.skip-link')).not.toBeInViewport(); await page.screenshot({path:`${testInfo.outputDir}/settings-desktop-dark.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844}); await page.evaluate(() => { window.scrollTo(0,0); (document.activeElement as HTMLElement)?.blur(); }); await page.screenshot({path:`${testInfo.outputDir}/settings-mobile-dark.png`,fullPage:true});
  await page.getByRole('button', { name:'Use light theme' }).first().click(); await page.reload(); await expect(page.getByLabel('Display name')).toBeVisible(); await expect(page.getByLabel('Display name')).toHaveCSS('background-color','rgb(255, 254, 250)'); await page.setViewportSize({width:1440,height:1000}); await page.evaluate(() => { window.scrollTo(0,0); (document.activeElement as HTMLElement)?.blur(); }); await page.screenshot({path:`${testInfo.outputDir}/settings-desktop-light.png`,fullPage:true});
  await page.goto('/sign-in'); await page.evaluate(() => { window.scrollTo(0,0); (document.activeElement as HTMLElement)?.blur(); }); await page.screenshot({path:`${testInfo.outputDir}/sign-in-desktop-light.png`,fullPage:true});
  expect(errors).toEqual([]);
});
test('session rechecks preserve drafts and session failures offer a working retry', async ({ page, account, mailLink }) => {
  await register(page, account); await page.goto(await mailLink(account.email,'Verify')); await signIn(page,account.email,account.password);
  await page.getByLabel('Display name').fill('Unsaved draft');
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/get-session**', async route => { await held; await route.continue(); });
  await expect(page.getByRole('status')).toContainText('Checking', { timeout:20000 });
  await expect(page.getByLabel('Display name')).not.toBeVisible();
  release(); await expect(page.getByLabel('Display name')).toHaveValue('Unsaved draft');
  await page.unroute('**/api/auth/get-session**');
  await page.route('**/api/auth/get-session**', route => route.fulfill({ status:503, contentType:'application/json', body:'{}' }));
  await page.reload(); await expect(page.locator('p[role=alert]')).toContainText('check your account');
  await expect(page.getByLabel('Display name')).not.toBeVisible();
  await page.unroute('**/api/auth/get-session**'); await page.getByRole('button', { name:'Retry' }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Private Cinema Name');
});

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createEmailVerificationToken } from 'better-auth/api';
import { createAuth } from '../dist/modules/auth/auth.config.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { DevelopmentEmailService } from '../dist/modules/email/development-email.service.js';
import { SessionGuard } from '../dist/modules/auth/session.guard.js';
import { RateLimitService } from '../dist/common/rate-limit.service.js';
import type { ExecutionContext } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, retrieveDevelopmentMail, createVerifiedUserClient, testConfig } from './fixtures.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
const inboxUrl = process.env.TEST_MAILPIT_URL!;
const smtpPort = Number(process.env.TEST_SMTP_PORT);
describe.skipIf(!enabled)('authentication through HTTP and SMTP (requires TEST_DATABASE_URL, TEST_MAILPIT_URL, TEST_SMTP_PORT)', () => {
  const db = enabled ? createTestDatabase() : undefined!;
  let app: INestApplication;
  const password = 'test-password-1234';
  const origin = testConfig.frontendOrigin;
  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/auth/${path}`).set('Origin', origin).send(body);
  const signup = (email: string) => post('sign-up/email', { email, password, name: 'Test User', username: `user${randomUUID().replaceAll('-', '').slice(0, 20)}` });
  const mail = (email: string, subject: string) => retrieveDevelopmentMail(email, subject, inboxUrl);
  async function verified(email: string) {
    expect((await signup(email)).status).toBe(200);
    const link = await mail(email, 'Verify');
    expect((await request(app.getHttpServer()).get(link.pathname + link.search)).status).toBe(302);
    const login = await post('sign-in/email', { email, password });
    expect(login.status).toBe(200);
    return login.headers['set-cookie'] as unknown as string[];
  }
  beforeAll(async () => {
    app = await createApplication({ ...testConfig, smtpPort, databaseUrl: process.env.TEST_DATABASE_URL! });
    await app.init();
  });
  beforeEach(async () => { await resetDatabase(db); });
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  it('requires verification and creates UUID database sessions only after verification', async () => {
    const email = `${randomUUID()}@example.test`;
    expect((await signup(email)).status).toBe(200);
    expect((await post('sign-in/email', { email, password })).status).toBe(403);
    expect(await db.session.count()).toBe(0);
    const link = await mail(email, 'Verify');
    expect((await request(app.getHttpServer()).get(link.pathname + link.search)).status).toBe(302);
    const login = await post('sign-in/email', { email, password });
    expect(login.status).toBe(200);
    expect((login.headers['set-cookie'] as unknown as string[]).join(';')).toContain('HttpOnly');
    const session = await db.session.findFirstOrThrow();
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('logout revokes the persisted session and expired sessions are rejected', async () => {
    const cookies = await verified(`${randomUUID()}@example.test`);
    expect((await request(app.getHttpServer()).get('/api/auth/get-session').set('Cookie', cookies)).body.user).toBeDefined();
    await db.session.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await request(app.getHttpServer()).get('/api/auth/get-session').set('Cookie', cookies)).body).toBeNull();
    const second = await post('sign-in/email', { email: (await db.user.findFirstOrThrow()).email, password });
    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Origin', origin).set('Cookie', second.headers['set-cookie']).send({}).expect(200);
    expect(await db.session.count()).toBe(0);
  });
  it('reset responses hide account existence; reset is single-use and revokes sessions', async () => {
    const email = `${randomUUID()}@example.test`;
    const cookies = await verified(email);
    const known = await post('request-password-reset', { email, redirectTo: `${origin}/reset-password` });
    const unknown = await post('request-password-reset', { email: 'unknown@example.test', redirectTo: `${origin}/reset-password` });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(JSON.stringify(known.body)).not.toContain('token');
    const link = await mail(email, 'Reset');
    const token = link.pathname.split('/').at(-1)!;
    expect((await post('reset-password', { token, newPassword: 'new-password-1234' })).status).toBe(200);
    expect(await db.session.count()).toBe(0);
    expect((await request(app.getHttpServer()).get('/api/auth/get-session').set('Cookie', cookies)).body).toBeNull();
    expect((await post('reset-password', { token, newPassword: password })).status).toBe(400);
  });
  it('expired reset tokens fail', async () => {
    const email = `${randomUUID()}@example.test`;
    await verified(email);
    await post('request-password-reset', { email, redirectTo: `${origin}/reset-password` });
    const token = (await mail(email, 'Reset')).pathname.split('/').at(-1)!;
    await db.verification.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await post('reset-password', { token, newPassword: password })).status).toBe(400);
  });
  it('rejects untrusted browser origins', async () => {
    expect((await request(app.getHttpServer()).post('/api/auth/sign-up/email').set('Origin', 'https://evil.example').send({ email: 'evil@example.test', password, name: 'Test', username: 'evil' })).status).toBe(403);
  });
  it('limits 10 attempts per IP without trusting forwarded IPs', async () => {
    for (let i = 0; i < 10; i++) expect((await post('sign-in/email', { email: 'nobody@example.test', password })).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/auth/sign-in/email').set('Origin', origin).set('X-Forwarded-For', '203.0.113.9').send({ email: 'nobody@example.test', password })).status).toBe(429);
  });
  it('limits 3 email requests per normalized account across request types', async () => {
    const email = `${randomUUID()}@example.test`;
    await signup(email);
    await post('request-password-reset', { email });
    await post('send-verification-email', { email });
    expect((await post('request-password-reset', { email: email.toUpperCase() })).status).toBe(429);
  });
  it('looks up guard sessions fresh after expiry, logout and reset', async () => {
    const guard = app.get(SessionGuard);
    const check = (cookies: string[]) => {
      const req = { headers: { cookie: cookies.map(c => c.split(';')[0]).join('; ') }, user: undefined as { id: string } | undefined };
      const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: () => undefined }) }) } as unknown as ExecutionContext;
      return { req, run: () => guard.canActivate(context) };
    };
    const email = `${randomUUID()}@example.test`;
    const cookies = await verified(email);
    const active = check(cookies);
    expect(await active.run()).toBe(true);
    expect(active.req.user).toEqual({ id: (await db.user.findFirstOrThrow()).id });
    await db.session.updateMany({ data: { expiresAt: new Date(0) } });
    await expect(check(cookies).run()).rejects.toThrow('Unauthorized');
    const login = await post('sign-in/email', { email, password });
    const second = login.headers['set-cookie'] as unknown as string[];
    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Origin', origin).set('Cookie', second).send({}).expect(200);
    await expect(check(second).run()).rejects.toThrow('Unauthorized');
    const third = await post('sign-in/email', { email, password });
    await post('request-password-reset', { email });
    const token = (await mail(email, 'Reset')).pathname.split('/').at(-1)!;
    await post('reset-password', { token, newPassword: 'reset-password-1234' });
    await expect(check(third.headers['set-cookie'] as unknown as string[]).run()).rejects.toThrow('Unauthorized');
  });
  it('rejects expired verification links', async () => {
    const email = `${randomUUID()}@example.test`;
    await signup(email);
    const token = await createEmailVerificationToken(testConfig.betterAuthSecret, email, undefined, -60);
    const response = await request(app.getHttpServer()).get('/api/auth/verify-email').query({ token });
    expect(response.status).toBe(401);
    expect((await db.user.findFirstOrThrow()).emailVerified).toBe(false);
  });
  it('consumes persistent limits atomically and permits a fresh window', async () => {
    const limiter = app.get(RateLimitService);
    const key = `concurrent-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.consume(key, 10, 60)));
    expect(results.filter(Boolean)).toHaveLength(10);
    await db.rateLimit.update({ where: { key }, data: { lastRequest: 0n } });
    expect(await limiter.consume(key, 10, 60)).toBe(true);
  });
  it('allows only one concurrent reset redemption', async () => {
    const email = `${randomUUID()}@example.test`;
    await verified(email);
    await post('request-password-reset', { email });
    const token = (await mail(email, 'Reset')).pathname.split('/').at(-1)!;
    const responses = await Promise.all([post('reset-password', { token, newPassword: 'new-password-one' }), post('reset-password', { token, newPassword: 'new-password-two' })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it('rejects missing mutation origins and untrusted callback destinations', async () => {
    expect((await request(app.getHttpServer()).post('/api/auth/sign-in/email').send({ email: 'a@example.test', password })).status).toBe(403);
    expect((await post('request-password-reset', { email: 'a@example.test', redirectTo: 'https://evil.example/reset' })).status).toBe(403);
  });
  it('provides a verified cookie client fixture', async () => {
    const { client } = await createVerifiedUserClient(app, undefined, inboxUrl);
    const response = await client.get('/api/auth/get-session');
    expect(response.body.user.emailVerified).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('requires username on registration with a validation response', async () => {
    expect((await post('sign-up/email', { email: 'identity@example.test', name: 'Identity', password })).status).toBe(422);
  });
  it('sets Secure and HttpOnly session cookies under production auth options', async () => {
    const email = `${randomUUID()}@example.test`;
    await verified(email);
    const auth = createAuth({ ...testConfig, nodeEnv: 'production', authBaseUrl: 'https://api.tracker.example', frontendOrigin: 'https://tracker.example' }, app.get(PrismaService), new DevelopmentEmailService(smtpPort));
    const response = await auth.handler(new Request('https://api.tracker.example/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://tracker.example' }, body: JSON.stringify({ email, password }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });
  it('does not reveal tokens when awaited SMTP delivery fails', async () => {
    const failedApp = await createApplication({ ...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: 51026 });
    await failedApp.init();
    try {
      const response = await request(failedApp.getHttpServer()).post('/api/auth/sign-up/email').set('Origin', origin).send({ email: 'delivery-failure@example.test', password, name: 'Failure', username: 'delivery_failure' });
      expect(response.status).toBe(200); // Better Auth intentionally preserves its signup enumeration response.
      await expect(new DevelopmentEmailService(51026).send({ to: 'local@example.test', subject: 'Failure', text: 'Local test' })).rejects.toThrow();
      expect(response.body.token).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('/verify-email');
    } finally { await failedApp.close(); }
  });

  it('does not expose username discovery or username sign-in plugin routes', async () => {
    expect((await post('is-username-available', { username: 'someone' })).status).toBe(404);
    expect((await post('sign-in/username', { username: 'someone', password })).status).toBe(404);
  });

});

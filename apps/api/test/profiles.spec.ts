import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, createVerifiedUserClient, testConfig } from './fixtures.js';
const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
describe.skipIf(!enabled)('profiles HTTP', () => {
 const db = enabled ? createTestDatabase() : undefined!;
 let app: INestApplication;
 beforeAll(async () => { app = await createApplication({...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: Number(process.env.TEST_SMTP_PORT), proxySharedSecret:'task5-isolated-proxy-secret-at-least-32-characters'}); await app.init(); });
 beforeEach(async () => { await resetDatabase(db); });
 afterAll(async () => { await app?.close(); await db.$disconnect(); });
 it('denies anonymous profile and me reads', async () => { await request(app.getHttpServer()).get('/api/me').expect(401); await request(app.getHttpServer()).get('/api/profiles/alice').expect(401); });
 it('returns public fields only, normalized exact discovery, and preserves legacy dotted identities', async () => {
  const {client} = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
  const user = await db.user.findFirstOrThrow();
  await db.user.update({where:{id:user.id},data:{username:'legacy.name',avatar:'https://unsafe.example'}});
  const res = await client.get('/api/profiles/LEGACY.NAME').expect(200);
  expect(res.body).toEqual({id:user.id,username:'legacy.name',displayName:'Test User',avatar:'default'});
  await client.get('/api/profiles/legacy').expect(404);
  await db.user.create({data:{id:crypto.randomUUID(),email:'exact@example.test',name:'Exact',username:'bobxone'}});
  await client.get('/api/profiles/bob_one').expect(404);
  await client.get('/api/profiles/%25').expect(404);
  await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).send({displayName:'Updated',avatar:'film'}).expect(200);
  expect((await db.user.findUniqueOrThrow({where:{id:user.id}})).username).toBe('legacy.name');
 });
 it('strictly validates editing, canonicalizes new usernames and enforces uniqueness', async () => {
  const {client} = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
  for(const body of [{username:'a.b'}, {displayName:''},{displayName:'x'.repeat(81)},{avatar:'https://evil.example'},{email:'new@example.test'},{username:null}]) await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).send(body).expect(400);
  await client.patch('/api/me').send({displayName:'Blocked'}).expect(403);
  await client.patch('/api/me').set('Origin','https://evil.example').send({displayName:'Blocked'}).expect(403);
  await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).set('X-Tracker-Client-IP','203.0.113.8').send({displayName:'Blocked'}).expect(403);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','task5-isolated-proxy-secret-at-least-32-characters').update(`PATCH\n/api/me\n${timestamp}\n203.0.113.8`).digest('hex');
  await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).set('X-Tracker-Client-IP','203.0.113.8').set('X-Tracker-Proxy-Time',timestamp).set('X-Tracker-Proxy-Signature',signature).send({displayName:'Signed'}).expect(200);
  const res=await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).send({username:'ALICE_1'}).expect(200);
  expect(res.body.username).toBe('alice_1');
  await db.user.create({data:{id:crypto.randomUUID(),email:'other@example.test',username:'taken',name:'Other'}});
  await client.patch('/api/me').set('Origin',testConfig.frontendOrigin).send({username:'TAKEN'}).expect(409);
 });
 it('rejects dotted new signup and normalizes uppercase signup', async () => {
  const post=(username:string)=>request(app.getHttpServer()).post('/api/auth/sign-up/email').set('Origin',testConfig.frontendOrigin).send({username,email:`${crypto.randomUUID()}@example.test`,password:'test-password-1234',name:'Test'});
  await post('new.name').expect(400); await post('NEW_NAME').expect(200);
  expect(await db.user.findFirst({where:{username:'new_name'}})).not.toBeNull();
 });
 it('blocks native auth profile editing bypass', async () => {
  const {client}=await createVerifiedUserClient(app,undefined,process.env.TEST_MAILPIT_URL);
  await client.post('/api/auth/update-user').set('Origin',testConfig.frontendOrigin).send({name:'x'.repeat(81)}).expect(404);
  expect((await db.user.findFirstOrThrow()).name).toBe('Test User');
 });
 it('discovery uses persistent per-user window with expiry', async () => {
  const {client}=await createVerifiedUserClient(app,undefined,process.env.TEST_MAILPIT_URL);
  const user=await db.user.findFirstOrThrow();
  for(let i=0;i<30;i++) await client.get('/api/profiles/absent').expect(404);
  await client.get('/api/profiles/absent').expect(429);
  await db.rateLimit.update({where:{key:`profile-discovery:${user.id}`},data:{lastRequest:0n}});
  await client.get('/api/profiles/absent').expect(404);
 });
});

import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, createVerifiedUserClient, createUser, createMedia, createSeason, testConfig } from './fixtures.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
describe.skipIf(!enabled)('friends feed HTTP / PostgreSQL', () => {
  const db = enabled ? createTestDatabase() : undefined!;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof createVerifiedUserClient>>['client'];
  let viewer: typeof owner;
  let ownerId: string;
  let viewerId: string;
  let mediaId: string;
  const origin = testConfig.frontendOrigin;
  const feed = (query = '') => viewer.get(`/api/feed${query}`);
  const patch = (id: string, body: object) => owner.patch(`/api/entries/${id}`).set('Origin', origin).send(body);
  const create = async (fields = {}) => (await owner.post('/api/entries').set('Origin', origin).send({ target: { mediaId }, status: 'WATCHING', ...fields }).expect(201)).body as { id: string };
  const relationship = (status: 'PENDING' | 'ACCEPTED' = 'ACCEPTED') => {
    const [userLowId, userHighId] = [ownerId, viewerId].sort() as [string, string];
    return db.friendship.create({ data: { userLowId, userHighId, requesterId: ownerId, status } });
  };
  beforeAll(async () => {
    app = await createApplication({ ...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: Number(process.env.TEST_SMTP_PORT) });
    await app.init();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    const actor = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    owner = actor.client; ownerId = (await db.user.findUniqueOrThrow({ where: { email: actor.email } })).id;
    const reader = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    viewer = reader.client; viewerId = (await db.user.findUniqueOrThrow({ where: { email: reader.email } })).id;
    mediaId = (await createMedia(db, { genres: ['Drama'] })).id;
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  it('requires fresh verified sessions and no-store on success and errors', async () => {
    const response = await request(app.getHttpServer()).get('/api/feed').expect(401);
    expect(response.headers['cache-control']).toContain('no-store'); expect(response.headers['cache-control']).toContain('private');
    const ok = await feed().expect(200); expect(ok.headers['cache-control']).toContain('no-store'); expect(ok.headers['cache-control']).toContain('private');
    await db.user.update({ where: { id: viewerId }, data: { emailVerified: false } });
    await feed().expect(401);
    await db.user.update({ where: { id: viewerId }, data: { emailVerified: true } });
    await db.session.deleteMany({ where: { userId: viewerId } });
    await feed().expect(401);
  });
  it('authorizes current entry owners before pagination and restores retained history on reacceptance', async () => {
    const entry = await create({ review: 'private review', rating: 8 });
    expect((await feed().expect(200)).body).toEqual({ items: [], nextCursor: null });
    const relation = await relationship('PENDING');
    expect((await feed().expect(200)).body.items).toEqual([]);
    await db.friendship.update({ where: { id: relation.id }, data: { status: 'ACCEPTED' } });
    await patch(entry.id, { rating: 9 }).expect(200);
    const first = (await feed('?limit=1').expect(200)).body;
    expect(first.items[0]).toMatchObject({ actor: { id: ownerId, displayName: 'Test User', avatar: 'default' }, entry: { id: entry.id, rating: 9, review: 'private review' }, type: 'RATING' });
    expect(first.nextCursor).toBeTypeOf('string');
    expect(JSON.stringify(first)).not.toContain('email');
    await db.friendship.delete({ where: { id: relation.id } });
    expect((await feed(`?cursor=${first.nextCursor}`).expect(200)).body).toEqual({ items: [], nextCursor: null });
    expect((await feed().expect(200)).body.items).toEqual([]);
    await relationship();
    expect((await feed().expect(200)).body.items).toHaveLength(2);
    expect((await owner.get('/api/feed').expect(200)).body.items).toEqual([]);
    // A corrupt activity actor must never authorize a different owner's entry.
    const outsider = await createUser(db);
    const secret = await db.watchEntry.create({ data: { userId: outsider.id, mediaId, status: 'WATCHING', review: 'stranger secret' } });
    await db.activity.create({ data: { actorId: ownerId, entryId: secret.id, type: 'REVIEW', createdAt: new Date('2099-01-01') } });
    const safe = (await feed('?limit=1').expect(200)).body;
    expect(safe.items).toHaveLength(1); expect(safe.items[0].entry.id).toBe(entry.id);
    expect(JSON.stringify(safe)).not.toContain('stranger secret');
  });
  it('resolves current reviews and season context, creates only real changes and removes deleted entries', async () => {
    await relationship();
    const entry = await create({ review: 'old text', rating: 8 });
    await patch(entry.id, { review: 'current text', status: 'WATCHED', completedOn: '2000-01-01', rating: 9 }).expect(200);
    await patch(entry.id, { status: 'WATCHED', review: 'current text', rating: 9 }).expect(200);
    await patch(entry.id, {}).expect(200);
    await patch(entry.id, { completedOn: '1999-01-01' }).expect(200);
    await owner.patch('/api/me').set('Origin', origin).send({ displayName: 'New Name', avatar: 'film' }).expect(200);
    const page = (await feed().expect(200)).body;
    expect(page.items).toHaveLength(4);
    expect(page.items.map((item: { type: string }) => item.type).sort()).toEqual(['RATING', 'REVIEW', 'STATUS', 'STATUS']);
    expect(page.items.every((item: { entry: { review: string }; actor: { displayName: string; avatar: string } }) => item.entry.review === 'current text' && item.actor.displayName === 'New Name' && item.actor.avatar === 'film')).toBe(true);
    expect(JSON.stringify(page)).not.toContain('old text');
    const season = await createSeason(db, mediaId);
    const seasonal = await create({ target: { seasonId: season.id } });
    const item = (await feed().expect(200)).body.items.find((row: { entry: { id: string } }) => row.entry.id === seasonal.id);
    expect(item.entry).toMatchObject({ target: { seasonId: season.id }, media: { id: mediaId, genres: ['Drama'] }, season: { id: season.id, seasonNumber: 1 } });
    await owner.delete(`/api/entries/${entry.id}`).set('Origin', origin).expect(200);
    expect((await feed().expect(200)).body.items).toHaveLength(1);
  });
  it('uses timestamp and id keysets across tied events, deleted cursors and unauthorized newer rows', async () => {
    await relationship();
    const entry = await create();
    await db.activity.deleteMany();
    const timestamp = new Date('2026-10-09T01:02:03.456Z');
    const ids = Array.from({ length: 55 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    await db.activity.createMany({ data: ids.map(id => ({ id, actorId: ownerId, entryId: entry.id, type: 'STATUS' as const, createdAt: timestamp })) });
    const olderId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await db.activity.create({ data: { id: olderId, actorId: ownerId, entryId: entry.id, type: 'STATUS', createdAt: new Date('2026-10-08') } });
    const stranger = await createUser(db);
    const hidden = await db.watchEntry.create({ data: { userId: stranger.id, mediaId, status: 'WATCHING' } });
    await db.activity.create({ data: { actorId: stranger.id, entryId: hidden.id, type: 'STATUS', createdAt: new Date('2099-01-01') } });
    const first = (await feed().expect(200)).body;
    expect(first.items).toHaveLength(20); expect(first.items[0].id).toBe(ids[54]); expect(first.items[19].id).toBe(ids[35]);
    expect(first.items[0].createdAt).toBe('2026-10-09T01:02:03.456Z');
    await db.activity.delete({ where: { id: first.items[19].id } });
    const second = (await feed(`?limit=50&cursor=${first.nextCursor}`).expect(200)).body;
    expect(second.items).toHaveLength(36); expect(second.items[0].id).toBe(ids[34]); expect(second.items[34].id).toBe(ids[0]); expect(second.items[35].id).toBe(olderId); expect(second.nextCursor).toBeNull();
    expect((await feed('?limit=50').expect(200)).body.items).toHaveLength(50);
  });
  it.each(['limit=0', 'limit=51', 'limit=01', 'limit=1.5', 'limit=x', 'limit=1&limit=2', 'cursor=', 'cursor=bad', 'cursor=abc&cursor=def', 'unknown=1', `cursor=${'a'.repeat(257)}`])('rejects invalid feed query %s without caching', async query => {
    const response = await feed(`?${query}`).expect(400); expect(response.headers['cache-control']).toContain('no-store'); expect(response.headers['cache-control']).toContain('private');
  });
  it('rejects invalid timestamps, UUIDs, shapes and noncanonical opaque cursor encodings', async () => {
    const good = ['2026-10-09T01:02:03.456Z', randomUUID()];
    for (const value of [[good[0], 'bad'], ['2026-02-30T00:00:00.000Z', good[1]], ['2026-10-09', good[1]], ['0000-01-01T00:00:00.000Z', good[1]], ['+999999-01-01T00:00:00.000Z', good[1]], [good[0], good[1], 'extra'], { timestamp: good[0], id: good[1] }]) {
      await feed(`?cursor=${Buffer.from(JSON.stringify(value)).toString('base64url')}`).expect(400);
    }
    const canonical = Buffer.from(JSON.stringify(good)).toString('base64url');
    await feed(`?cursor=${canonical}=`).expect(400);
    await feed(`?cursor=${Buffer.from(JSON.stringify(good, null, 1)).toString('base64url')}`).expect(400);
    await feed(`?cursor=${canonical}`).expect(200);
  });
  it('shows no partial events or changed content after transaction rollback and never contacts OMDb', async () => {
    await relationship();
    const entry = await create({ review: 'original' });
    await db.$executeRawUnsafe(`CREATE FUNCTION task8_fail_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'REVIEW' THEN RAISE EXCEPTION 'fail review'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe('CREATE TRIGGER task8_review_failure BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION task8_fail_review()');
      await patch(entry.id, { status: 'WATCHED', completedOn: '2026-10-10', rating: 9, review: 'failed text' }).expect(500);
      const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External access forbidden'));
      try {
        const page = (await feed().expect(200)).body;
        expect(page.items).toHaveLength(1); expect(page.items[0].entry).toMatchObject({ review: 'original', status: 'WATCHING', rating: null });
      } finally { external.mockRestore(); }
      expect(await db.activity.count()).toBe(1);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS task8_review_failure ON "Activity"');
      await db.$executeRawUnsafe('DROP FUNCTION task8_fail_review()');
    }
  });
});

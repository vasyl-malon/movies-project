import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, createVerifiedUserClient, createUser, createMedia, createSeason, testConfig } from './fixtures.js';

// Real HTTP, sessions and PostgreSQL: removing guards, locking, transitions or
// transaction-bound activities must break the assertions. OMDb is never contacted.
const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
describe.skipIf(!enabled)('private watch entries HTTP / PostgreSQL', () => {
  const db = enabled ? createTestDatabase() : undefined!;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof createVerifiedUserClient>>['client'];
  let friend: typeof owner;
  let ownerId: string;
  let friendId: string;
  let mediaId: string;
  let seasonId: string;
  const origin = testConfig.frontendOrigin;
  const post = (body: object) => owner.post('/api/entries').set('Origin', origin).send(body);
  const patch = (id: string, body: object) => owner.patch(`/api/entries/${id}`).set('Origin', origin).send(body);
  const create = async (fields = {}) => (await post({ target: { mediaId }, status: 'WATCHING', ...fields }).expect(201)).body;
  const list = (query = '') => owner.get(`/api/users/${ownerId}/entries${query}`);
  const friendship = async (status: 'PENDING' | 'ACCEPTED') => {
    const [userLowId, userHighId] = [ownerId, friendId].sort() as [string, string];
    return db.friendship.create({ data: { userLowId, userHighId, requesterId: ownerId, status } });
  };
  beforeAll(async () => {
    app = await createApplication({ ...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: Number(process.env.TEST_SMTP_PORT) });
    await app.init();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    const actor = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    owner = actor.client;
    ownerId = (await db.user.findUniqueOrThrow({ where: { email: actor.email } })).id;
    const other = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    friend = other.client;
    friendId = (await db.user.findUniqueOrThrow({ where: { email: other.email } })).id;
    const media = await createMedia(db, { genres: ['Drama'], imdbRating: 8.5 });
    mediaId = media.id;
    seasonId = (await createSeason(db, mediaId)).id;
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  it('requires fresh verified sessions and no-store even on rejected routes', async () => {
    for (const method of ['get', 'patch', 'delete'] as const) {
      const res = await request(app.getHttpServer())[method](`/api/entries/${randomUUID()}`).expect(401);
      expect(res.headers['cache-control']).toContain('no-store');
    }
    const res = await request(app.getHttpServer()).post('/api/entries').send({}).expect(401);
    expect(res.headers['cache-control']).toContain('no-store');
    await request(app.getHttpServer()).get(`/api/users/${ownerId}/entries`).expect(401);
    await db.user.update({ where: { id: ownerId }, data: { emailVerified: false } });
    await list().expect(401);
    await post({ target: { mediaId }, status: 'WATCHING' }).expect(401);
  });
  it('returns private owner content only to currently accepted friends', async () => {
    const entry = await create({ review: '<script>private text</script>', rating: 9 });
    expect(entry).toMatchObject({ ownerId, target: { mediaId }, review: '<script>private text</script>', rating: 9, completedOn: null });
    expect(typeof entry.rating).toBe('number');
    expect(entry.media.genres).toEqual(['Drama']);
    expect(JSON.stringify(entry)).not.toContain('email');
    await owner.get(`/api/entries/${entry.id}`).expect(200);
    const deny = await friend.get(`/api/entries/${entry.id}`).expect(403);
    expect(deny.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(deny.body)).not.toContain('private text');
    await friend.get(`/api/users/${ownerId}/entries`).expect(403);
    const relation = await friendship('PENDING');
    await friend.get(`/api/entries/${entry.id}`).expect(403);
    await db.friendship.update({ where: { id: relation.id }, data: { status: 'ACCEPTED' } });
    await friend.get(`/api/entries/${entry.id}`).expect(200);
    const page = await friend.get(`/api/users/${ownerId}/entries?ratingMin=9`).expect(200);
    expect(page.body.items).toHaveLength(1);
    await db.friendship.delete({ where: { id: relation.id } });
    await friend.get(`/api/entries/${entry.id}`).expect(403);
    await friend.get(`/api/users/${ownerId}/entries`).expect(403);
  });
  it('denies foreign mutations and untrusted mutation origins', async () => {
    const entry = await create();
    await friendship('ACCEPTED');
    await friend.patch(`/api/entries/${entry.id}`).set('Origin', origin).send({ rating: 8 }).expect(404);
    await friend.delete(`/api/entries/${entry.id}`).set('Origin', origin).expect(404);
    await owner.patch(`/api/entries/${entry.id}`).send({ rating: 8 }).expect(403);
    await owner.delete(`/api/entries/${entry.id}`).set('Origin', 'https://evil.test').expect(403);
    await owner.post('/api/entries').send({ target: { seasonId }, status: 'WATCHING' }).expect(403);
    expect((await db.watchEntry.findUniqueOrThrow({ where: { id: entry.id } })).rating).toBeNull();
  });
  it.each([
    { target: {}, status: 'WATCHING' }, { target: { mediaId: 'bad' }, status: 'WATCHING' },
    { target: { mediaId: 'bad' } }, { status: null }, { status: 'watched' },
    { rating: 0 }, { rating: 11 }, { rating: 1.5 }, { rating: '8' },
    { review: 'x'.repeat(10001) }, { review: {} }, { unknown: true },
    { ownerId: randomUUID() }, { completedOn: '2026-02-30' }, { localToday: '2026-13-01' },
    { completedOn: '2026-01-01T00:00:00Z' }, { localToday: null },
  ])('strictly rejects invalid create fields %#', async fields => {
    await post({ target: { mediaId }, status: 'WATCHING', ...fields }).expect(400);
    expect(await db.watchEntry.count()).toBe(0); expect(await db.activity.count()).toBe(0);
  });
  it('requires exactly one existing target and prevents immutable target/owner patches', async () => {
    await post({ status: 'WATCHING' }).expect(400);
    await post({ target: { mediaId } }).expect(400);
    await post({ target: { mediaId, seasonId }, status: 'WATCHING' }).expect(400);
    await post({ target: { mediaId, extra: true }, status: 'WATCHING' }).expect(400);
    await post({ target: null, status: 'WATCHING' }).expect(400);
    await post({ target: { mediaId: randomUUID() }, status: 'WATCHING' }).expect(404);
    const entry = await create();
    for (const body of [{ target: { seasonId } }, { mediaId }, { ownerId: friendId }, { userId: friendId }, { status: null }, { unknown: 1 }]) await patch(entry.id, body).expect(400);
  });
  it('rejects explicit Plan ratings and clears a prior omitted rating on transition', async () => {
    await post({ target: { mediaId }, status: 'PLAN_TO_WATCH', rating: 8 }).expect(400);
    await post({ target: { seasonId }, status: 'PLAN_TO_WATCH', rating: null }).expect(201);
    const entry = await create({ rating: 8 });
    await patch(entry.id, { status: 'PLAN_TO_WATCH', rating: 8 }).expect(400);
    const result = await patch(entry.id, { status: 'PLAN_TO_WATCH' }).expect(200);
    expect(result.body.rating).toBeNull();
    await patch(entry.id, { rating: 8 }).expect(400);
    await patch(entry.id, { rating: null }).expect(200);
    expect((await db.activity.findMany()).map(a => a.type).sort()).toEqual(['RATING', 'STATUS', 'STATUS', 'STATUS']);
  });
  it('uses only the supplied local calendar date, preserves it on unrelated edits and clears on exit', async () => {
    await post({ target: { mediaId }, status: 'WATCHED' }).expect(400);
    const entry = await create();
    await patch(entry.id, { status: 'WATCHED' }).expect(400);
    const result = await patch(entry.id, { status: 'WATCHED', localToday: '2026-10-11' }).expect(200);
    expect(result.body.completedOn).toBe('2026-10-11');
    expect((await db.watchEntry.findUniqueOrThrow({ where: { id: entry.id } })).completedAt?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect((await patch(entry.id, { review: 'hello', localToday: '2026-10-12' }).expect(200)).body.completedOn).toBe('2026-10-11');
    expect((await patch(entry.id, { status: 'DROPPED' }).expect(200)).body.completedOn).toBeNull();
    expect((await patch(entry.id, { status: 'WATCHED', completedOn: '2024-02-29' }).expect(200)).body.completedOn).toBe('2024-02-29');
  });
  it('supports nullable fields, strict calendar validation and explicit completion dates', async () => {
    const entry = await create({ status: 'WATCHED', completedOn: null, rating: 8, review: 'text' });
    expect(entry.completedOn).toBeNull();
    const cleared = await patch(entry.id, { rating: null, review: null }).expect(200);
    expect(cleared.body).toMatchObject({ rating: null, review: null, completedOn: null });
    for (const completedOn of ['2023-02-29', '0000-01-01', '2026-04-31', '2026-1-01', 123]) await patch(entry.id, { completedOn }).expect(400);
    await patch(entry.id, { completedOn: '2024-02-29' }).expect(200);
    await patch(entry.id, { status: 'WATCHING', completedOn: '2024-02-29' }).expect(400);
    await patch(entry.id, { review: 'x'.repeat(10000) }).expect(200);
  });
  it('records only genuine status/rating/review changes and no historical review payload', async () => {
    const entry = await create({ rating: 8, review: 'initial' });
    expect(await db.activity.count()).toBe(1);
    await patch(entry.id, { rating: 8, review: 'initial', status: 'WATCHING' }).expect(200);
    await patch(entry.id, {}).expect(200);
    expect(await db.activity.count()).toBe(1);
    await patch(entry.id, { status: 'WATCHED', completedOn: '2026-10-10', rating: 9, review: '<b>current</b>' }).expect(200);
    expect(await db.activity.count()).toBe(4);
    await patch(entry.id, { completedOn: '2026-10-09' }).expect(200);
    expect(await db.activity.count()).toBe(4);
    expect(JSON.stringify(await db.activity.findMany())).not.toContain('current');
    await owner.delete(`/api/entries/${entry.id}`).set('Origin', origin).expect(200);
    expect(await db.watchEntry.count()).toBe(0); expect(await db.activity.count()).toBe(0);
  });
  it('conflicts concurrent duplicate creates without duplicate events and keeps seasons independent', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post({ target: { mediaId }, status: 'WATCHING' })));
    expect(results.map(r => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await db.watchEntry.count()).toBe(1); expect(await db.activity.count()).toBe(1);
    const season = await post({ target: { seasonId }, status: 'WATCHED', localToday: '2026-10-10' }).expect(201);
    expect(season.body.media.genres).toEqual(['Drama']);
    const rows = await db.watchEntry.findMany();
    expect(rows.find(r => r.mediaId === mediaId)?.status).toBe('WATCHING');
    expect(rows.find(r => r.seasonId === seasonId)?.status).toBe('WATCHED');
    await createSeason(db, mediaId, 2);
    expect(await db.watchEntry.count()).toBe(2);
  });
  it('serializes concurrent retries and independent field updates without lost edits or duplicate events', async () => {
    const entry = await create();
    const changes = await Promise.all(Array.from({ length: 8 }, () => patch(entry.id, { status: 'WATCHED', localToday: '2026-10-10', rating: 8 })));
    expect(changes.every(r => r.status === 200)).toBe(true);
    expect(await db.activity.count()).toBe(3);
    const edits = await Promise.all([patch(entry.id, { review: 'preserve me' }), patch(entry.id, { rating: 9 })]);
    expect(edits.every(r => r.status === 200)).toBe(true);
    const stored = await db.watchEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.review).toBe('preserve me'); expect(Number(stored.rating)).toBe(9);
    expect(await db.activity.count()).toBe(5);
  });
  it('rolls back both create and update when activity insertion fails', async () => {
    // Database trigger fails actual inserts after the entry write; no writer mock.
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION task7_fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activity failed'; END $$`);
    try {
      await db.$executeRawUnsafe('CREATE TRIGGER task7_activity_failure BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION task7_fail_activity()');
      await post({ target: { mediaId }, status: 'WATCHING' }).expect(500);
      expect(await db.watchEntry.count()).toBe(0);
      await db.$executeRawUnsafe('DROP TRIGGER task7_activity_failure ON "Activity"');
      const entry = await create();
      await db.$executeRawUnsafe('CREATE TRIGGER task7_activity_failure BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION task7_fail_activity()');
      const response = await patch(entry.id, { rating: 9 }).expect(500);
      expect(response.headers['cache-control']).toContain('no-store');
      expect((await db.watchEntry.findUniqueOrThrow({ where: { id: entry.id } })).rating).toBeNull();
      expect(await db.activity.count()).toBe(1);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS task7_activity_failure ON "Activity"');
      await db.$executeRawUnsafe('DROP FUNCTION task7_fail_activity()');
    }
  });
  it('applies inclusive owner rating/date/status filters and inherited season genres, excluding nulls', async () => {
    const entry = await create({ status: 'WATCHED', rating: 8, completedOn: '2026-10-10' });
    await post({ target: { seasonId }, status: 'WATCHED', completedOn: null }).expect(201);
    const another = await createMedia(db, { type: 'MOVIE', genres: ['Comedy'] });
    await post({ target: { mediaId: another.id }, status: 'WATCHED', rating: 10, completedOn: '2026-10-12' }).expect(201);
    const stranger = await createUser(db);
    await db.watchEntry.create({ data: { userId: stranger.id, mediaId, status: 'WATCHED', rating: 8, completedAt: new Date('2026-10-10') } });
    expect((await list('?status=WATCHED&genre=Drama').expect(200)).body.items).toHaveLength(2);
    const filtered = await list('?status=WATCHED&genre=Drama&ratingMin=8&ratingMax=8&from=2026-10-10&to=2026-10-10').expect(200);
    expect(filtered.body.items.map((e: { id: string }) => e.id)).toEqual([entry.id]);
    expect((await list('?from=2026-10-10').expect(200)).body.items).toHaveLength(2);
    expect((await list('?ratingMax=10').expect(200)).body.items).toHaveLength(2);
  });
  it.each(['limit=0', 'limit=51', 'limit=01', 'limit=1.5', 'cursor=bad', 'status=watched', 'ratingMin=0', 'ratingMax=11', 'ratingMin=1.5', 'ratingMin=9&ratingMax=2', 'from=2026-02-30', 'from=2026-10-11&to=2026-10-10', 'genre=', 'unknown=1', 'status=WATCHED&status=WATCHING', 'limit=1&limit=2', 'from='])('rejects strict list queries %s', async query => { await list(`?${query}`).expect(400); });
  it('bounds pages and uses stable keysets independent of updates or deleted cursor entries', async () => {
    const media = await Promise.all(Array.from({ length: 52 }, () => createMedia(db)));
    await db.watchEntry.createMany({ data: media.map(m => ({ userId: ownerId, mediaId: m.id, status: 'WATCHING' })) });
    const first = (await list().expect(200)).body;
    expect(first.items).toHaveLength(20); expect(first.nextCursor).toBe(first.items.at(-1).id);
    await patch(first.items[0].id, { review: 'edited' }).expect(200);
    await owner.delete(`/api/entries/${first.nextCursor}`).set('Origin', origin).expect(200);
    const second = (await list(`?cursor=${first.nextCursor}&limit=50`).expect(200)).body;
    expect(second.items).toHaveLength(32); expect(second.nextCursor).toBeNull();
    expect(second.items.every((e: { id: string }) => e.id > first.nextCursor)).toBe(true);
    expect((await list('?limit=50').expect(200)).body.items).toHaveLength(50);
  });
  it('never invokes OMDb to resolve an existing entry target', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try { await create(); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });
});

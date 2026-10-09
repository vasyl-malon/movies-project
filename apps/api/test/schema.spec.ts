import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, createUser, createMedia, createSeason, resetDatabase } from './fixtures.js';

// Removing any migration constraint must allow the corresponding invalid SQL write.
// An explicit dedicated test URL is required; never fall back to DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('PostgreSQL integrity', () => {
  const db = new pg.Pool({ connectionString: url });
  const prisma = url ? createTestDatabase() : undefined!;
  let user: string;
  let media: string;
  let season: string;
  const insertEntry = (values: Record<string, unknown> = {}) => {
    const row = { id: randomUUID(), userId: user, mediaId: media, status: 'WATCHED', ...values };
    const keys = Object.keys(row);
    return db.query(`INSERT INTO "WatchEntry" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!parsed.pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL database must end in _test');
    await db.query('SELECT 1');
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    user = (await createUser(prisma)).id;
    media = (await createMedia(prisma)).id;
    season = (await createSeason(prisma, media)).id;
  });
  afterAll(async () => { await db.end(); await prisma.$disconnect(); });
  it('rejects duplicate user/media entries concurrently', async () => {
    const results = await Promise.allSettled([insertEntry(), insertEntry()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: '23505' });
  });
  it('rejects duplicate user/season entries', async () => {
    await insertEntry({ mediaId: null, seasonId: season });
    await expect(insertEntry({ mediaId: null, seasonId: season })).rejects.toMatchObject({ code: '23505' });
  });
  it.each([{ mediaId: null }, { seasonId: 'season-placeholder' }])('requires exactly one target: %j', async values => {
    await expect(insertEntry({ ...values, ...(values.seasonId ? { seasonId: season } : {}) })).rejects.toMatchObject({ code: '23514' });
  });
  it.each([0, 11, 7.5])('rejects raw SQL rating %s', async rating => {
    await expect(insertEntry({ rating })).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects Plan to Watch ratings on insert and update', async () => {
    await expect(insertEntry({ status: 'PLAN_TO_WATCH', rating: 5 })).rejects.toMatchObject({ code: '23514' });
    await insertEntry({ rating: 5 });
    await expect(db.query('UPDATE "WatchEntry" SET status=\'PLAN_TO_WATCH\'')).rejects.toMatchObject({ code: '23514' });
  });
  it('keeps series and seasons independent and accepts boundary ratings', async () => {
    await insertEntry({ rating: 1 });
    await insertEntry({ mediaId: null, seasonId: season, rating: 10 });
    expect((await db.query('SELECT * FROM "WatchEntry"')).rowCount).toBe(2);
  });
  it('enforces unique season identity and positive numbering', async () => {
    await expect(db.query('INSERT INTO "Season" (id,"mediaId","seasonNumber") VALUES ($1,$2,1)', [randomUUID(), media])).rejects.toMatchObject({ code: '23505' });
    await expect(db.query('INSERT INTO "Season" (id,"mediaId","seasonNumber") VALUES ($1,$2,0)', [randomUUID(), media])).rejects.toMatchObject({ code: '23514' });
  });
  it('restricts seasons to series even after media type changes', async () => {
    await expect(db.query('UPDATE "Media" SET type=\'MOVIE\' WHERE id=$1', [media])).rejects.toMatchObject({ code: '23503' });
  });
  it('enforces case-insensitive username identity', async () => {
    await db.query('UPDATE "User" SET username=\'Alice\' WHERE id=$1', [user]);
    await expect(db.query('INSERT INTO "User" (id,email,name,username,"updatedAt") VALUES ($1,$2,\'Other\',\'aLiCe\',NOW())', [randomUUID(), 'other@example.test'])).rejects.toMatchObject({ code: '23505' });
  });
  it('rejects reciprocal concurrent friendships and invalid requester/self pairs', async () => {
    const other = randomUUID();
    await db.query('INSERT INTO "User" (id,email,name,username,"updatedAt") VALUES ($1,$2,\'Other\',$1,NOW())', [other, `${other}@example.test`]);
    const [low, high] = [user, other].sort();
    const request = (a: string, b: string, requester: string) => db.query('INSERT INTO "Friendship" (id,"userLowId","userHighId","requesterId") VALUES ($1,$2,$3,$4)', [randomUUID(), a, b, requester]);
    const results = await Promise.allSettled([request(low!, high!, user), request(low!, high!, other)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: '23505' });
    await expect(request(high!, low!, user)).rejects.toMatchObject({ code: '23514' });
    await expect(request(user, user, user)).rejects.toMatchObject({ code: '23514' });
    await expect(request(low!, high!, randomUUID())).rejects.toMatchObject({ code: '23514' });
  });
  it('stores completion as a calendar date and forbids it outside Watched', async () => {
    await insertEntry({ completedAt: '2026-10-08' });
    expect((await db.query('SELECT "completedAt"::text AS date FROM "WatchEntry"')).rows[0].date).toBe('2026-10-08');
    await expect(db.query('UPDATE "WatchEntry" SET status=\'WATCHING\'')).rejects.toMatchObject({ code: '23514' });
  });
  it('cascades entry and user deletion to private records without deleting media', async () => {
    const entry = randomUUID();
    await insertEntry({ id: entry });
    await db.query('INSERT INTO "Activity" (id,"actorId","entryId",type) VALUES ($1,$2,$3,\'STATUS\')', [randomUUID(), user, entry]);
    await db.query('DELETE FROM "WatchEntry" WHERE id=$1', [entry]);
    expect((await db.query('SELECT * FROM "Activity"')).rowCount).toBe(0);
    await insertEntry();
    await db.query('INSERT INTO "Account" (id,"accountId","providerId","userId","updatedAt") VALUES ($1,$2,\'credential\',$2,NOW())', [randomUUID(), user]);
    await db.query('INSERT INTO "Session" (id,token,"userId","expiresAt","updatedAt") VALUES ($1,$1,$2,NOW()+INTERVAL \'1 day\',NOW())', [randomUUID(), user]);
    await db.query('DELETE FROM "User" WHERE id=$1', [user]);
    for (const table of ['WatchEntry', 'Account', 'Session', 'Activity']) expect((await db.query(`SELECT * FROM "${table}"`)).rowCount).toBe(0);
    expect((await db.query('SELECT * FROM "Media"')).rowCount).toBe(1);
  });
});

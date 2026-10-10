import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, createVerifiedUserClient, createUser, createMedia, createSeason, testConfig } from './fixtures.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
describe.skipIf(!enabled)('anonymous community ratings HTTP / PostgreSQL', () => {
  const db = enabled ? createTestDatabase() : undefined!;
  let app: INestApplication;
  let client: Awaited<ReturnType<typeof createVerifiedUserClient>>['client'];
  let userId: string;
  let mediaId: string;
  let seasonId: string;
  const rating = (kind = 'media', id = mediaId) => client.get(`/api/community/${kind}/${id}`);
  const contribution = async (target: { mediaId: string } | { seasonId: string }, value: number | null, status: 'WATCHED' | 'WATCHING' | 'DROPPED' = 'WATCHED') => {
    const user = await createUser(db);
    return db.watchEntry.create({ data: { userId: user.id, ...target, status, rating: value, review: 'private individual review' } });
  };
  beforeAll(async () => {
    app = await createApplication({ ...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: Number(process.env.TEST_SMTP_PORT) }); await app.init();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    const viewer = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    client = viewer.client; userId = (await db.user.findUniqueOrThrow({ where: { email: viewer.email } })).id;
    mediaId = (await createMedia(db)).id; seasonId = (await createSeason(db, mediaId)).id;
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  it('requires fresh verified sessions and no-store including validation and missing-target errors', async () => {
    for (const path of [`media/${mediaId}`, `seasons/${seasonId}`]) {
      const response = await request(app.getHttpServer()).get(`/api/community/${path}`).expect(401); expect(response.headers['cache-control']).toContain('no-store'); expect(response.headers['cache-control']).toContain('private');
    }
    for (const kind of ['media', 'seasons']) {
      const invalid = await rating(kind, 'bad').expect(400); expect(invalid.headers['cache-control']).toContain('no-store'); expect(invalid.headers['cache-control']).toContain('private');
      const missing = await rating(kind, randomUUID()).expect(404); expect(missing.headers['cache-control']).toContain('no-store'); expect(missing.headers['cache-control']).toContain('private');
    }
    await db.user.update({ where: { id: userId }, data: { emailVerified: false } }); await rating().expect(401);
    await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
    await db.session.deleteMany({ where: { userId } }); await rating('seasons', seasonId).expect(401);
  });
  it('hides both values below three distinct rated Watched contributors and exposes only aggregate fields', async () => {
    expect((await rating().expect(200)).body).toEqual({ average: null, count: null });
    await contribution({ mediaId }, 7); await contribution({ mediaId }, 8);
    await contribution({ mediaId }, 10, 'WATCHING'); await contribution({ mediaId }, 10, 'DROPPED'); await contribution({ mediaId }, null);
    expect((await rating().expect(200)).body).toEqual({ average: null, count: null });
    await contribution({ mediaId }, 8);
    const result = await rating().expect(200);
    expect(result.body).toEqual({ average: 7.7, count: 3 }); expect(result.headers['cache-control']).toContain('no-store'); expect(result.headers['cache-control']).toContain('private');
    expect(await db.friendship.count()).toBe(0);
  });
  it('reflects current rating edits, status transitions, deletions and restored eligibility immediately', async () => {
    const entry = (await client.post('/api/entries').set('Origin', testConfig.frontendOrigin).send({ target: { mediaId }, status: 'WATCHED', localToday: '2026-10-10', rating: 6 }).expect(201)).body;
    await contribution({ mediaId }, 8); await contribution({ mediaId }, 10);
    expect((await rating().expect(200)).body).toEqual({ average: 8, count: 3 });
    const patch = (body: object) => client.patch(`/api/entries/${entry.id}`).set('Origin', testConfig.frontendOrigin).send(body);
    await patch({ rating: 9 }).expect(200); expect((await rating().expect(200)).body).toEqual({ average: 9, count: 3 });
    await patch({ status: 'WATCHING' }).expect(200); expect((await rating().expect(200)).body).toEqual({ average: null, count: null });
    await patch({ status: 'WATCHED', localToday: '2026-10-10' }).expect(200); expect((await rating().expect(200)).body).toEqual({ average: 9, count: 3 });
    await patch({ rating: null }).expect(200); expect((await rating().expect(200)).body).toEqual({ average: null, count: null });
    await patch({ rating: 3 }).expect(200); expect((await rating().expect(200)).body).toEqual({ average: 7, count: 3 });
    await client.delete(`/api/entries/${entry.id}`).set('Origin', testConfig.frontendOrigin).expect(200); expect((await rating().expect(200)).body).toEqual({ average: null, count: null });
  });
  it('keeps movie, series and each season independent, never rolling up child contributions or fetching metadata', async () => {
    const movieId = (await createMedia(db, { type: 'MOVIE' })).id;
    const secondSeason = (await createSeason(db, mediaId, 2)).id;
    for (let i = 0; i < 3; i++) {
      await contribution({ mediaId: movieId }, 4); await contribution({ mediaId }, 6);
      await contribution({ seasonId }, 10); await contribution({ seasonId: secondSeason }, 2);
    }
    const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External access forbidden'));
    try {
      expect((await rating('media', movieId).expect(200)).body).toEqual({ average: 4, count: 3 });
      expect((await rating().expect(200)).body).toEqual({ average: 6, count: 3 });
      expect((await rating('seasons', seasonId).expect(200)).body).toEqual({ average: 10, count: 3 });
      expect((await rating('seasons', secondSeason).expect(200)).body).toEqual({ average: 2, count: 3 });
    } finally { external.mockRestore(); }
    await db.watchEntry.deleteMany({ where: { seasonId } });
    expect((await rating('seasons', seasonId).expect(200)).body).toEqual({ average: null, count: null });
    expect((await rating().expect(200)).body).toEqual({ average: 6, count: 3 });
  });
});

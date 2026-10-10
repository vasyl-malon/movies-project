import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../dist/bootstrap.js';
import { createTestDatabase, resetDatabase, createVerifiedUserClient, createUser, testConfig } from './fixtures.js';

// Removing validation, caching, DB quota reservation, guard or mapping must break these assertions.
// Only the provider boundary is mocked; sessions, HTTP handlers and PostgreSQL are real.
const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_MAILPIT_URL && process.env.TEST_SMTP_PORT);
const originalFetch = globalThis.fetch;
const movie = { Response: 'True', imdbID: 'tt1234567', Type: 'movie', Title: 'A Movie', Year: '2020', Poster: 'N/A', Genre: 'Drama, Sci-Fi, Drama', Plot: 'N/A', imdbRating: 'N/A' };
const series = { ...movie, imdbID: 'tt7654321', Type: 'series', Title: 'A Series', Poster: 'https://example.test/poster.jpg', imdbRating: '8.5', totalSeasons: '3' };
const hit = (type = 'movie', id = 'tt1234567') => ({ imdbID: id, Type: type, Title: type === 'movie' ? 'A Movie' : 'A Series', Year: 'N/A', Poster: 'N/A' });
const search = (items: unknown[] = [hit()], total = '1') => ({ Response: 'True', Search: items, totalResults: total });

describe.skipIf(!enabled)('OMDb media HTTP / persisted metadata (explicit isolated services required)', () => {
  const db = enabled ? createTestDatabase() : undefined!;
  let app: INestApplication;
  let client: Awaited<ReturnType<typeof createVerifiedUserClient>>['client'];
  let actorId: string;
  let respond: (url: URL, init?: RequestInit) => unknown | Promise<unknown>;
  let calls: URL[];
  beforeAll(async () => {
    app = await createApplication({ ...testConfig, databaseUrl: process.env.TEST_DATABASE_URL!, smtpPort: Number(process.env.TEST_SMTP_PORT) });
    await app.init();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    calls = [];
    respond = () => movie;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.origin === new URL(process.env.TEST_MAILPIT_URL!).origin) return originalFetch(input, init);
      expect(url.origin).toBe('https://www.omdbapi.com');
      expect(url.pathname).toBe('/');
      expect(url.searchParams.get('apikey')).toBe('test-placeholder-key');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeDefined();
      calls.push(url);
      return new Response(JSON.stringify(await respond(url, init)), { status: 200 });
    });
    const actor = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    client = actor.client;
    actorId = (await db.user.findUniqueOrThrow({ where: { email: actor.email } })).id;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  const detail = () => client.get('/api/media/imdb/tt1234567');
  const quota = async (count: number, age = 0) => {
    await db.$executeRaw`INSERT INTO "RateLimit" (id,key,count,"lastRequest") VALUES ('quota','omdb:daily',${count}, floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint - ${age})`;
  };
  it('requires a fresh verified session on all four routes', async () => {
    for (const path of ['/api/media/search?q=movie', '/api/media/imdb/tt1234567', '/api/media/00000000-0000-4000-8000-000000000000/seasons', '/api/media/00000000-0000-4000-8000-000000000000/seasons/1']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await db.user.update({ where: { id: actorId }, data: { emailVerified: false } });
    await client.get('/api/media/search?q=movie').expect(401);
    expect(calls).toHaveLength(0);
  });
  it.each(['q=ab', 'q=abc&type=episode', 'q=abc&page=0', 'q=abc&page=101', 'q=abc&page=1.1', 'q=abc&page=01', 'q=abc&url=https://evil.test', 'q=abc&q=def', 'q=abc&type=movie&type=series'])('validates strict search inputs: %s', async query => {
    await client.get(`/api/media/search?${query}`).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('normalizes typed searches, caches success for 15 minutes and does not spend quota on cache hits', async () => {
    respond = () => search([hit(), hit('episode', 'tt1111111')]);
    const first = await client.get('/api/media/search?q=%20Movie%20&type=movie&page=1').expect(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body).toEqual({ items: [{ imdbId: 'tt1234567', type: 'MOVIE', title: 'A Movie', releaseYear: null, posterUrl: null }], page: 1, nextPage: null });
    await client.get('/api/media/search?q=movie&type=movie').expect(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get('type')).toBe('movie');
    expect(calls[0]!.searchParams.get('page')).toBe('1');
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(1);
    const cache = await db.mediaCache.findFirstOrThrow();
    expect(cache.expiresAt.getTime() - cache.createdAt.getTime()).toBeGreaterThan(14 * 60_000);
    expect(cache.expiresAt.getTime() - cache.createdAt.getTime()).toBeLessThanOrEqual(15 * 60_000);
    await db.mediaCache.updateMany({ data: { expiresAt: new Date(0) } });
    await client.get('/api/media/search?q=movie&type=movie').expect(200);
    expect(calls).toHaveLength(2);
  });
  it('explicitly searches both types with deterministic interleaved pages and excludes episodes', async () => {
    respond = url => search(url.searchParams.get('type') === 'movie' ? [hit(), hit('episode', 'tt1111111')] : [hit('series', 'tt7654321')], '21');
    const result = await client.get('/api/media/search?q=movie&page=2').expect(200);
    expect(result.body.items.map((item: { type: string }) => item.type)).toEqual(['MOVIE', 'SERIES']);
    expect(result.body.page).toBe(2); expect(result.body.nextPage).toBe(3);
    expect(calls.map(url => url.searchParams.get('type')).sort()).toEqual(['movie', 'series']);
    expect(calls.every(url => url.searchParams.get('page') === '2')).toBe(true);
    await client.get('/api/media/search?q=movie&page=2').expect(200);
    expect(calls).toHaveLength(2);
  });
  it('enforces the 30/minute user search limit including cache hits and keeps users separate', async () => {
    respond = () => search();
    for (let i = 0; i < 30; i++) await client.get('/api/media/search?q=movie&type=movie').expect(200);
    await client.get('/api/media/search?q=movie&type=movie').expect(429);
    const other = await createVerifiedUserClient(app, undefined, process.env.TEST_MAILPIT_URL);
    await other.client.get('/api/media/search?q=movie&type=movie').expect(200);
    expect(calls).toHaveLength(1);
  });
  it('persists unique selected movie details with nullable absent fields and 24 hour normalized cache', async () => {
    const first = await detail().expect(200);
    expect(first.body).toMatchObject({ imdbId: movie.imdbID, type: 'MOVIE', title: movie.Title, synopsis: null, posterUrl: null, imdbRating: null, genres: ['Drama', 'Sci-Fi'], totalSeasons: null });
    expect(first.body).not.toHaveProperty('entries'); expect(first.body).not.toHaveProperty('communityRating');
    await detail().expect(200);
    expect(calls).toHaveLength(1); expect(await db.media.count()).toBe(1);
    expect((await db.mediaCache.findFirstOrThrow()).expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect((await db.media.findFirstOrThrow()).refreshedAt).not.toBeNull();
  });
  it('materializes unique seasons from parent count without episode calls, fetches only chosen season, and inherits display context', async () => {
    respond = url => url.searchParams.has('Season') ? { Response: 'True', Title: 'A Series', Season: '2', totalSeasons: '3', Episodes: [{ Title: 'Episode', Episode: '1', Released: 'N/A', imdbID: 'tt1111111', imdbRating: '9.1' }] } : series;
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    expect(parent.imdbRating).toBe(8.5); expect(parent.totalSeasons).toBe(3);
    const list = await client.get(`/api/media/${parent.id}/seasons`).expect(200);
    expect(list.body.items.map((s: { seasonNumber: number }) => s.seasonNumber)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    const chosen = await client.get(`/api/media/${parent.id}/seasons/2`).expect(200);
    expect(chosen.body).toMatchObject({ media: { id: parent.id, posterUrl: series.Poster, genres: ['Drama', 'Sci-Fi'] }, season: { seasonNumber: 2 }, episodes: [{ title: 'Episode', episodeNumber: 1, releasedOn: null, imdbId: 'tt1111111' }] });
    expect(chosen.body).not.toHaveProperty('imdbRating');
    await client.get(`/api/media/${parent.id}/seasons/2`).expect(200);
    expect(calls).toHaveLength(2); expect(calls[1]!.searchParams.get('Season')).toBe('2');
    expect(await db.season.count()).toBe(3);
    await client.get(`/api/media/${parent.id}/seasons/4`).expect(404);
    await client.get(`/api/media/${parent.id}/seasons/0`).expect(400);
  });
  it('returns missing season metadata fallback on genuine not found, without caching failure', async () => {
    respond = () => series;
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    respond = () => ({ Response: 'False', Error: 'Season not found!' });
    const result = await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(result.body.episodes).toBeNull();
    const row = await db.season.findFirstOrThrow({ where: { mediaId: parent.id, seasonNumber: 1 } });
    expect(row.refreshedAt).toBeNull(); expect(row.metadata).toBeNull();
    await client.get(`/api/media/${parent.id}/seasons/1`).expect(200); expect(calls).toHaveLength(3);
  });
  it('refreshes stale selection details but keeps stale saved targets/lists usable during outage/quota exhaustion', async () => {
    respond = () => series;
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    await db.media.updateMany({ data: { refreshedAt: new Date(0) } });
    await db.mediaCache.updateMany({ data: { expiresAt: new Date(0) } });
    respond = () => { throw new Error('secret URL https://www.omdbapi.com/?apikey=test-placeholder-key'); };
    const { MediaService } = await import('../dist/modules/media/media.service.js');
    const service = app.get(MediaService);
    const saved = await service.resolveTarget({ mediaId: parent.id });
    expect(saved).toMatchObject({ target: { mediaId: parent.id }, media: { id: parent.id }, season: null });
    const list = await client.get(`/api/media/${parent.id}/seasons`).expect(200);
    expect(calls).toHaveLength(1);
    const resolvedSeason = await service.resolveTarget({ seasonId: list.body.items[0].id });
    expect(resolvedSeason.media.posterUrl).toBe(series.Poster);
    expect(resolvedSeason.season?.seasonNumber).toBe(1);
    await client.get('/api/media/imdb/tt7654321').expect(200);
    await db.rateLimit.update({ where: { key: 'omdb:daily' }, data: { count: 950 } });
    await client.get('/api/media/imdb/tt7654321').expect(200);
    await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(calls).toHaveLength(2);
    await expect(service.resolveTarget({ mediaId: parent.id, seasonId: list.body.items[0].id } as never)).rejects.toThrow();
    await expect(service.resolveTarget({ mediaId: 'bad' })).rejects.toThrow();
  });
  it.each([
    [{ Response: 'False', Error: 'Movie not found!' }, 404, 'NOT_FOUND'],
    [{ Response: 'False', Error: 'Invalid API key! test-placeholder-key' }, 503, 'OMDB_UNAVAILABLE'],
    [{ Response: 'False', Error: 'Request limit reached!' }, 503, 'OMDB_QUOTA_EXHAUSTED'],
    [{ Response: 'False', Error: 'private strange error test-placeholder-key' }, 503, 'OMDB_UNAVAILABLE'],
    [{ Response: 'True', Title: 'Missing identity' }, 502, 'OMDB_INVALID_RESPONSE'],
    [{ ...movie, imdbID: 'tt1111111' }, 502, 'OMDB_INVALID_RESPONSE'],
    [{ ...movie, Type: 'episode' }, 404, 'NOT_FOUND'],
    [null, 502, 'OMDB_INVALID_RESPONSE'],
  ])('classifies provider outcome safely and never caches failure %#', async (body, status, code) => {
    respond = () => body;
    const result = await detail().expect(status);
    expect(result.body.code).toBe(code);
    expect(JSON.stringify(result.body)).not.toContain('test-placeholder-key');
    expect(await db.mediaCache.count()).toBe(0); expect(await db.media.count()).toBe(0);
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(1);
  });
  it('distinguishes genuine empty search, caches empty success and does not cache invalid responses', async () => {
    respond = () => ({ Response: 'False', Error: 'Movie not found!' });
    const empty = await client.get('/api/media/search?q=missing&type=movie').expect(200);
    expect(empty.body.items).toEqual([]);
    await client.get('/api/media/search?q=missing&type=movie').expect(200); expect(calls).toHaveLength(1);
    respond = () => search([ { imdbID: 'bad', Type: 'movie', Title: 'Bad' } ]);
    await client.get('/api/media/search?q=malformed&type=movie').expect(502);
    expect(await db.mediaCache.count()).toBe(1);
  });
  it('rejects arbitrary IMDb targets and movies as season parents before provider access', async () => {
    await client.get('/api/media/imdb/https%3A%2F%2Fevil.test').expect(400);
    await client.get('/api/media/imdb/tt1').expect(400);
    const row = (await detail().expect(200)).body;
    await client.get(`/api/media/${row.id}/seasons`).expect(404);
    await client.get('/api/media/bad/seasons').expect(400);
    expect(calls).toHaveLength(1);
  });
  it('reserves every outbound failure, redacts fetch exceptions and enforces five second timeout', async () => {
    respond = async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('test-placeholder-key')), { once: true }); });
    const result = await detail().expect(504);
    expect(result.body).toEqual({ code: 'OMDB_TIMEOUT', message: 'Media provider timed out.' });
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(1);
    expect(await db.mediaCache.count()).toBe(0);
  }, 8000);
  it('never allows more than 950 outbound calls across concurrent client instances, and resets at UTC midnight', async () => {
    await quota(940);
    const { OmdbClient } = await import('../dist/modules/media/omdb.client.js');
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const dbService = app.get(PrismaService);
    const clients = [new OmdbClient(dbService, testConfig.omdbApiKey), new OmdbClient(dbService, testConfig.omdbApiKey)];
    const outcomes = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => clients[i % 2]!.request({ i: 'tt1234567' })));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(10);
    expect(calls).toHaveLength(10);
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(950);
    await db.rateLimit.update({ where: { key: 'omdb:daily' }, data: { lastRequest: 0n } });
    await clients[0]!.request({ i: 'tt1234567' });
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(1);
  });
  it('preserves cached successes at exhausted quota while returning clear state for fresh discovery', async () => {
    respond = () => search();
    await client.get('/api/media/search?q=movie&type=movie').expect(200);
    await db.rateLimit.update({ where: { key: 'omdb:daily' }, data: { count: 950 } });
    await client.get('/api/media/search?q=movie&type=movie').expect(200);
    const fresh = await client.get('/api/media/search?q=fresh&type=movie').expect(503);
    expect(fresh.body.code).toBe('OMDB_QUOTA_EXHAUSTED'); expect(calls).toHaveLength(1);
  });
  it('persists a unique IMDb parent and unique seasons under concurrent selection', async () => {
    respond = () => series;
    const results = await Promise.all(Array.from({ length: 5 }, () => client.get('/api/media/imdb/tt7654321')));
    expect(results.every(result => result.status === 200)).toBe(true);
    expect(new Set(results.map(result => result.body.id)).size).toBe(1);
    expect(await db.media.count()).toBe(1); expect(await db.season.count()).toBe(3);
  });
  it('handles unknown season count without inventing seasons and resolves a selected provider season', async () => {
    respond = () => ({ ...series, totalSeasons: 'N/A', Genre: 'N/A', Poster: undefined });
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    expect(parent).toMatchObject({ totalSeasons: null, genres: [], posterUrl: null });
    expect((await client.get(`/api/media/${parent.id}/seasons`).expect(200)).body).toEqual({ items: [], totalSeasons: null });
    respond = () => ({ Response: 'True', Season: '1', Episodes: [] });
    const chosen = await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(chosen.body.episodes).toEqual([]);
    expect(await db.season.count()).toBe(1);
  });
  it('bounds malformed season counts before materialization', async () => {
    respond = () => ({ ...series, totalSeasons: '999999999' });
    const result = await client.get('/api/media/imdb/tt7654321').expect(502);
    expect(result.body.code).toBe('OMDB_INVALID_RESPONSE');
    expect(await db.media.count()).toBe(0); expect(await db.season.count()).toBe(0);
  });
  it('applies the five second deadline to body reads after headers arrive', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"Response":'));
        setTimeout(() => controller.close(), 6000);
      },
    })));
    const start = Date.now();
    const result = await detail().expect(504);
    expect(result.body.code).toBe('OMDB_TIMEOUT');
    expect(Date.now() - start).toBeLessThan(5500);
    expect(await db.mediaCache.count()).toBe(0);
  }, 8000);
  it('bounds provider response bodies even when valid metadata has huge extra fields', async () => {
    respond = () => ({ ...movie, padding: 'x'.repeat(600_000) });
    const result = await detail().expect(502);
    expect(result.body.code).toBe('OMDB_INVALID_RESPONSE');
    expect(await db.mediaCache.count()).toBe(0);
  });
  it('resets yesterday 23:59:59 at this UTC midnight and keeps this day count at midnight', async () => {
    const [clock] = await db.$queryRaw<{ midnight: bigint }[]>`SELECT floor(extract(epoch FROM date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint AS midnight`;
    await quota(950);
    await db.rateLimit.update({ where: { key: 'omdb:daily' }, data: { lastRequest: clock!.midnight - 1n } });
    await detail().expect(200);
    const row = await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } });
    expect(row.count).toBe(1); expect(row.lastRequest).toBe(clock!.midnight);
    await db.media.deleteMany(); await db.mediaCache.deleteMany();
    await db.rateLimit.update({ where: { key: 'omdb:daily' }, data: { count: 950 } });
    await detail().expect(503);
    expect(calls).toHaveLength(1);
  });
  it('ignores corrupted normalized caches and refreshes instead of leaking arbitrary fields', async () => {
    respond = () => search();
    await client.get('/api/media/search?q=movie&type=movie').expect(200);
    await db.mediaCache.updateMany({ data: { value: { items: [{ imdbId: 'tt1234567', type: 'MOVIE', title: 'A Movie', releaseYear: null, posterUrl: null, providerSecret: 'test-placeholder-key' }], total: 1 } } });
    const result = await client.get('/api/media/search?q=movie&type=movie').expect(200);
    expect(JSON.stringify(result.body)).not.toContain('providerSecret');
    expect(calls).toHaveLength(2);
  });
  it('does not mask a genuine provider not-found when refreshing a saved selection', async () => {
    await detail().expect(200);
    await db.media.updateMany({ data: { refreshedAt: new Date(0) } });
    await db.mediaCache.updateMany({ data: { expiresAt: new Date(0) } });
    respond = () => ({ Response: 'False', Error: 'Movie not found!' });
    await detail().expect(404);
    expect(await db.media.count()).toBe(1);
  });
  it('reuses season metadata for 24 hours then refreshes only the selected season', async () => {
    respond = () => series;
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    respond = () => ({ Response: 'True', Season: '1', Episodes: [] });
    await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(calls).toHaveLength(2);
    await db.season.updateMany({ where: { mediaId: parent.id, seasonNumber: 1 }, data: { refreshedAt: new Date(0) } });
    await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(calls).toHaveLength(3);
  });
  it('rejects a season response for a different number without caching provider metadata', async () => {
    respond = () => series;
    const parent = (await client.get('/api/media/imdb/tt7654321').expect(200)).body;
    respond = () => ({ Response: 'True', Season: '2', Episodes: [] });
    const result = await client.get(`/api/media/${parent.id}/seasons/1`).expect(200);
    expect(result.body.episodes).toBeNull();
    const saved = await db.season.findFirstOrThrow({ where: { mediaId: parent.id, seasonNumber: 1 } });
    expect(saved.refreshedAt).toBeNull();
  });
  it('redacts HTTP and invalid JSON provider failures and counts each real attempt', async () => {
    vi.stubGlobal('fetch', async () => new Response('test-placeholder-key', { status: 500 }));
    const httpError = await detail().expect(503);
    expect(httpError.body.code).toBe('OMDB_UNAVAILABLE');
    vi.stubGlobal('fetch', async () => new Response('test-placeholder-key', { status: 200 }));
    const jsonError = await detail().expect(502);
    expect(jsonError.body.code).toBe('OMDB_INVALID_RESPONSE');
    expect(JSON.stringify([httpError.body, jsonError.body])).not.toContain('test-placeholder-key');
    expect((await db.rateLimit.findUniqueOrThrow({ where: { key: 'omdb:daily' } })).count).toBe(2);
    expect(await db.mediaCache.count()).toBe(0);
  });
  it('allows no user or entry records in normalized shared metadata caches', async () => {
    await createUser(db, { name: 'PRIVATE_ENTRY_AUTHOR' });
    await detail().expect(200);
    const payload = JSON.stringify((await db.mediaCache.findMany()).map(c => c.value));
    expect(payload).not.toContain('PRIVATE_ENTRY_AUTHOR'); expect(payload).not.toContain('apikey'); expect(payload).not.toContain('Response');
  });
});

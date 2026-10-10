import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntryTarget, MediaDetail, MediaDisplay, MediaSearchPage, ResolvedTarget, SeasonDetail, SeasonList, SeasonEpisode } from '@tracker/contracts';
import type { Media, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { OmdbClient, OmdbError } from './omdb.client.js';
import { IMDB_ID, MAX_SEASONS, isDetailCache, isSearchCache, isSeasonCache, mapDetail, mapSearch, mapSeason, type MappedDetail } from './omdb.mapper.js';

const METADATA_MS = 24 * 3600_000;
const SEARCH_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertMediaId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestException();
}
export function assertSeasonNumber(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > MAX_SEASONS) throw new BadRequestException();
  return Number(value);
}
function display(row: Media): MediaDisplay {
  return { id: row.id, imdbId: row.imdbId, type: row.type, title: row.title, releaseYear: row.releaseYear, posterUrl: row.posterUrl, genres: row.genres };
}
const detailKey = (imdbId: string) => `omdb:v1:detail:${imdbId}`;
const fresh = (time: Date | null) => time !== null && time.getTime() > Date.now() - METADATA_MS;

@Injectable()
export class MediaService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(OmdbClient) private readonly omdb: OmdbClient, @Inject(RateLimitService) private readonly limits: RateLimitService) {}

  async search(userId: string, query: string, type: 'movie' | 'series' | undefined, page: number): Promise<MediaSearchPage> {
    // Rate limit every valid authenticated request, including shared cache hits.
    if (!await this.limits.consume(`media-search:${userId}`, 30, 60)) throw new HttpException('Too many requests.', 429);
    const normalized = query.trim().toLowerCase();
    const types = type ? [type] : ['movie', 'series'] as const;
    const results = [];
    for (const kind of types) {
      const hash = createHash('sha256').update(normalized).digest('hex');
      const key = `omdb:v1:search:${kind}:${page}:${hash}`;
      const cache = await this.db.mediaCache.findUnique({ where: { key } });
      if (cache && cache.expiresAt.getTime() > Date.now() && isSearchCache(cache.value)) { results.push(cache.value); continue; }
      const result = mapSearch(await this.omdb.request({ s: normalized, type: kind, page: String(page) }), kind);
      await this.db.mediaCache.upsert({ where: { key }, create: { key, value: result as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + SEARCH_MS) }, update: { value: result as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + SEARCH_MS) } });
      results.push(result);
    }
    const items: MediaSearchPage['items'] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) for (const result of results) {
      const item = result.items[i];
      if (item && !seen.has(item.imdbId)) { seen.add(item.imdbId); items.push(item); }
    }
    return { items, page, nextPage: page < 100 && results.some(r => r.total > page * 10) ? page + 1 : null };
  }

  private savedDetail(row: Media, cache: unknown): MediaDetail {
    return { ...display(row), synopsis: row.synopsis, imdbRating: row.imdbRating === null ? null : Number(row.imdbRating), totalSeasons: isDetailCache(cache) && cache.imdbId === row.imdbId ? cache.totalSeasons : null };
  }

  async detail(imdbId: string): Promise<MediaDetail> {
    if (!IMDB_ID.test(imdbId)) throw new BadRequestException();
    const [saved, cache] = await Promise.all([
      this.db.media.findUnique({ where: { imdbId } }),
      this.db.mediaCache.findUnique({ where: { key: detailKey(imdbId) } }),
    ]);
    if (saved && fresh(saved.refreshedAt) && cache && cache.expiresAt.getTime() > Date.now() && isDetailCache(cache.value) && cache.value.imdbId === imdbId) return this.savedDetail(saved, cache.value);
    try {
      const body = await this.omdb.request({ i: imdbId, plot: 'full' });
      if (!body) throw new NotFoundException();
      const mapped = mapDetail(body, imdbId);
      if (!mapped) throw new NotFoundException();
      return await this.persistDetail(mapped);
    } catch (error) {
      // Saved display data survives provider outages. Genuine not-found and local
      // input/storage failures remain errors rather than masking invalid state.
      if (saved && error instanceof OmdbError) return this.savedDetail(saved, cache?.value);
      throw error;
    }
  }

  private async persistDetail(mapped: MappedDetail): Promise<MediaDetail> {
    const now = new Date();
    return this.db.$transaction(async tx => {
      const { totalSeasons, ...fields } = mapped;
      const row = await tx.media.upsert({ where: { imdbId: mapped.imdbId }, create: { ...fields, refreshedAt: now }, update: { ...fields, refreshedAt: now } });
      if (row.type === 'SERIES' && totalSeasons !== null) {
        await tx.season.createMany({ data: Array.from({ length: totalSeasons }, (_, i) => ({ mediaId: row.id, seasonNumber: i + 1 })), skipDuplicates: true });
      }
      const key = detailKey(mapped.imdbId);
      const value = mapped as unknown as Prisma.InputJsonValue;
      await tx.mediaCache.upsert({ where: { key }, create: { key, value, expiresAt: new Date(now.getTime() + METADATA_MS) }, update: { value, expiresAt: new Date(now.getTime() + METADATA_MS) } });
      return { ...mapped, id: row.id };
    });
  }

  private async parent(mediaId: string) {
    assertMediaId(mediaId);
    const row = await this.db.media.findUnique({ where: { id: mediaId } });
    if (!row || row.type !== 'SERIES') throw new NotFoundException();
    const cache = await this.db.mediaCache.findUnique({ where: { key: detailKey(row.imdbId) } });
    const cachedDetail = cache?.value;
    const count = isDetailCache(cachedDetail) && cachedDetail.imdbId === row.imdbId ? cachedDetail.totalSeasons : null;
    return { row, count };
  }

  async seasons(mediaId: string): Promise<SeasonList> {
    const { count } = await this.parent(mediaId);
    const rows = await this.db.season.findMany({ where: { mediaId }, orderBy: { seasonNumber: 'asc' } });
    return { items: rows.map(row => ({ id: row.id, seasonNumber: row.seasonNumber })), totalSeasons: count };
  }

  async season(mediaId: string, number: number): Promise<SeasonDetail> {
    const { row: parent, count } = await this.parent(mediaId);
    if (!Number.isInteger(number) || number < 1 || number > MAX_SEASONS) throw new BadRequestException();
    if (count !== null && number > count) throw new NotFoundException();
    let saved = await this.db.season.findUnique({ where: { mediaId_seasonNumber: { mediaId, seasonNumber: number } } });
    let episodes: SeasonEpisode[] | null = saved && isSeasonCache(saved.metadata) ? saved.metadata : null;
    if (!saved || !fresh(saved.refreshedAt) || episodes === null) {
      try {
        const body = await this.omdb.request({ i: parent.imdbId, Season: String(number) });
        if (body) {
          episodes = mapSeason(body, number);
          const data = { metadata: episodes as unknown as Prisma.InputJsonValue, refreshedAt: new Date() };
          saved = await this.db.season.upsert({ where: { mediaId_seasonNumber: { mediaId, seasonNumber: number } }, create: { mediaId, seasonNumber: number, ...data }, update: data });
        } else if (!saved) { throw new NotFoundException(); }
      } catch (error) {
        if (!(saved && error instanceof OmdbError)) throw error;
      }
    }
    if (!saved) throw new NotFoundException();
    return { target: { seasonId: saved.id }, media: display(parent), season: { id: saved.id, seasonNumber: number }, episodes };
  }

  /** Task 7 uses this DB-only boundary: no outbound refresh or private data. */
  async resolveTarget(target: EntryTarget): Promise<ResolvedTarget> {
    if (!target || typeof target !== 'object' || Object.keys(target).length !== 1) throw new BadRequestException();
    if ('mediaId' in target) {
      assertMediaId(target.mediaId);
      const row = await this.db.media.findUnique({ where: { id: target.mediaId } });
      if (!row) throw new NotFoundException();
      return { target: { mediaId: row.id }, media: display(row), season: null };
    }
    if (!('seasonId' in target)) throw new BadRequestException();
    assertMediaId(target.seasonId);
    const row = await this.db.season.findUnique({ where: { id: target.seasonId }, include: { media: true } });
    if (!row || row.media.type !== 'SERIES') throw new NotFoundException();
    return { target: { seasonId: row.id }, media: display(row.media), season: { id: row.id, seasonNumber: row.seasonNumber } };
  }
}

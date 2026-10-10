import type { MediaSearchItem, MediaDetail, SeasonEpisode } from '@tracker/contracts';
import { OmdbError } from './omdb.client.js';

export const IMDB_ID = /^tt\d{7,10}$/;
export const MAX_SEASONS = 100;
const invalid = (): never => { throw new OmdbError('OMDB_INVALID_RESPONSE'); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const title = (value: unknown): string => typeof value === 'string' && value.trim() && value.length <= 500 && value !== 'N/A' ? value.trim() : invalid();
const nullableText = (value: unknown, max = 10000): string | null => value === undefined || value === null || value === 'N/A' || value === '' ? null : typeof value === 'string' && value.length <= max ? value : invalid();
const imdb = (value: unknown): string => typeof value === 'string' && IMDB_ID.test(value) ? value : invalid();
const integer = (value: unknown, max: number): number => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= max ? Number(value) : invalid();
export function poster(value: unknown): string | null {
  const text = nullableText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    // A poster must not expose an OMDb key or request its paid poster API.
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'img.omdbapi.com' || url.searchParams.has('apikey')) return null;
    return url.href;
  } catch { return null; }
}
function searchItem(body: Record<string, unknown>): MediaSearchItem {
  return { imdbId: imdb(body.imdbID), type: body.Type === 'movie' ? 'MOVIE' : body.Type === 'series' ? 'SERIES' : invalid(), title: title(body.Title), releaseYear: nullableText(body.Year, 40), posterUrl: poster(body.Poster) };
}
export function mapSearch(body: Record<string, unknown> | null, expectedType: 'movie' | 'series'): { items: MediaSearchItem[]; total: number } {
  if (body === null) return { items: [], total: 0 };
  if (!Array.isArray(body.Search) || body.Search.length > 10 || typeof body.totalResults !== 'string' || !/^\d{1,9}$/.test(body.totalResults)) return invalid();
  const items: MediaSearchItem[] = [];
  for (const value of body.Search) {
    const item = record(value);
    if (item.Type === 'episode') continue;
    if (item.Type !== expectedType) return invalid();
    items.push(searchItem(item));
  }
  return { items, total: Number(body.totalResults) };
}
export type MappedDetail = Omit<MediaDetail, 'id'>;
export function mapDetail(body: Record<string, unknown>, expectedId: string): MappedDetail | null {
  if (imdb(body.imdbID) !== expectedId) return invalid();
  if (body.Type === 'episode') return null;
  const base = searchItem(body);
  const genre = nullableText(body.Genre, 1000);
  const genres = genre ? [...new Set(genre.split(',').map(g => g.trim()).filter(Boolean))] : [];
  const ratingText = nullableText(body.imdbRating, 20);
  let imdbRating: number | null = null;
  if (ratingText !== null) {
    if (!/^\d{1,2}(\.\d)?$/.test(ratingText) || Number(ratingText) < 0 || Number(ratingText) > 10) return invalid();
    imdbRating = Number(ratingText);
  }
  const count = nullableText(body.totalSeasons, 10);
  return { ...base, genres, synopsis: nullableText(body.Plot), imdbRating, totalSeasons: base.type === 'SERIES' && count !== null ? integer(count, MAX_SEASONS) : null };
}
export function mapSeason(body: Record<string, unknown>, number: number): SeasonEpisode[] {
  if (integer(body.Season, MAX_SEASONS) !== number || !Array.isArray(body.Episodes) || body.Episodes.length > 1000) return invalid();
  const numbers = new Set<number>();
  return body.Episodes.map(value => {
    const episode = record(value);
    const episodeNumber = integer(episode.Episode, 1000);
    if (numbers.has(episodeNumber)) return invalid();
    numbers.add(episodeNumber);
    const id = nullableText(episode.imdbID, 20);
    return { title: title(episode.Title), episodeNumber, releasedOn: nullableText(episode.Released, 80), imdbId: id === null ? null : imdb(id) };
  });
}

// Cached values are normalized, versioned application data, never raw provider bodies.
// Invalid cache records are ignored and refreshed rather than returned to clients.
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const exactKeys = (v: object, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const itemKeys = ['imdbId', 'type', 'title', 'releaseYear', 'posterUrl'];
export function isSearchCache(value: unknown): value is { items: MediaSearchItem[]; total: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as { items?: unknown; total?: unknown };
  return exactKeys(v, ['items', 'total']) && Number.isSafeInteger(v.total) && Number(v.total) >= 0 && Array.isArray(v.items) && v.items.length <= 10 && v.items.every(item => {
    if (!item || typeof item !== 'object') return false;
    const i = item as MediaSearchItem;
    return exactKeys(i, itemKeys) && typeof i.imdbId === 'string' && IMDB_ID.test(i.imdbId) && ['MOVIE', 'SERIES'].includes(i.type) && typeof i.title === 'string' && i.title.length > 0 && i.title.length <= 500 && textOrNull(i.releaseYear) && textOrNull(i.posterUrl) && (i.posterUrl === null || i.posterUrl.length <= 2048 && poster(i.posterUrl) === i.posterUrl);
  });
}
export function isDetailCache(value: unknown): value is MappedDetail {
  if (!value || typeof value !== 'object') return false;
  const d = value as MappedDetail;
  const item = { imdbId: d.imdbId, type: d.type, title: d.title, releaseYear: d.releaseYear, posterUrl: d.posterUrl };
  return exactKeys(d, [...itemKeys, 'synopsis', 'genres', 'imdbRating', 'totalSeasons']) && isSearchCache({ items: [item], total: 1 }) && textOrNull(d.synopsis) && Array.isArray(d.genres) && d.genres.every(g => typeof g === 'string') && (d.imdbRating === null || typeof d.imdbRating === 'number' && d.imdbRating >= 0 && d.imdbRating <= 10) && (d.totalSeasons === null || Number.isInteger(d.totalSeasons) && d.totalSeasons > 0 && d.totalSeasons <= MAX_SEASONS);
}
export function isSeasonCache(value: unknown): value is SeasonEpisode[] {
  return Array.isArray(value) && value.length <= 1000 && value.every(v => v && typeof v === 'object' && exactKeys(v, ['title', 'episodeNumber', 'releasedOn', 'imdbId']) && typeof v.title === 'string' && Number.isInteger(v.episodeNumber) && v.episodeNumber > 0 && v.episodeNumber <= 1000 && textOrNull(v.releasedOn) && (v.imdbId === null || typeof v.imdbId === 'string' && IMDB_ID.test(v.imdbId)));
}

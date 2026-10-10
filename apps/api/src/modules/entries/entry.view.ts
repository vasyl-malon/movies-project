import type { EntryView } from '@tracker/contracts';
import type { Prisma } from '../../generated/prisma/client.js';

const mediaSelect = { id: true, imdbId: true, type: true, title: true, releaseYear: true, posterUrl: true, genres: true } as const;
/** Only transport fields: shared by private entry reads and authorized feed reads. */
export const entrySelect = {
  id: true, userId: true, mediaId: true, seasonId: true, status: true, rating: true,
  review: true, completedAt: true, createdAt: true, updatedAt: true,
  media: { select: mediaSelect },
  season: { select: { id: true, seasonNumber: true, media: { select: mediaSelect } } },
} as const;
type EntryRow = Prisma.WatchEntryGetPayload<{ select: typeof entrySelect }>;
export function entryView(row: EntryRow): EntryView {
  const media = row.media ?? row.season!.media;
  return {
    id: row.id, ownerId: row.userId, target: row.mediaId ? { mediaId: row.mediaId } : { seasonId: row.seasonId! },
    status: row.status, rating: row.rating === null ? null : Number(row.rating), review: row.review,
    completedOn: row.completedAt?.toISOString().slice(0, 10) ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    media: { id: media.id, imdbId: media.imdbId, type: media.type, title: media.title, releaseYear: media.releaseYear, posterUrl: media.posterUrl, genres: media.genres },
    season: row.season ? { id: row.season.id, seasonNumber: row.season.seasonNumber } : null,
  };
}

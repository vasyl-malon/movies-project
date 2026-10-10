import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EntryTarget, EntryView, Page } from '@tracker/contracts';
import type { Prisma, WatchEntry } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PrivateAccessService } from '../friends/private-access.service.js';
import { MediaService } from '../media/media.service.js';
import { ActivityWriter } from '../activity/activity-writer.service.js';
import { isUniqueConflict } from '../profiles/profiles.service.js';
import { entrySelect, entryView } from './entry.view.js';
import { calendarDate, type EntryCreateInput, type EntryUpdateInput, type EntryListQuery } from './entry.dto.js';

function changes(input: EntryCreateInput | EntryUpdateInput, before: WatchEntry | null) {
  const status = input.status ?? before!.status;
  if (status === 'PLAN_TO_WATCH' && input.rating !== undefined && input.rating !== null) throw new BadRequestException();
  const rating = status === 'PLAN_TO_WATCH' ? null : input.rating !== undefined ? input.rating : before?.rating ?? null;
  const review = input.review !== undefined ? input.review : before?.review ?? null;
  let completedAt: Date | null;
  if (status !== 'WATCHED') {
    if (input.completedOn !== undefined && input.completedOn !== null) throw new BadRequestException();
    completedAt = null;
  } else if (input.completedOn !== undefined) {
    completedAt = input.completedOn === null ? null : calendarDate(input.completedOn);
  } else if (before?.status !== 'WATCHED') {
    if (!input.localToday) throw new BadRequestException();
    completedAt = calendarDate(input.localToday);
  } else {
    completedAt = before.completedAt;
  }
  return { status, rating, review, completedAt };
}
@Injectable()
export class EntriesService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PrivateAccessService) private readonly access: PrivateAccessService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(ActivityWriter) private readonly activity: ActivityWriter,
  ) {}
  async create(userId: string, input: EntryCreateInput): Promise<EntryView> {
    const { mediaId, seasonId } = input.target;
    if ((mediaId !== undefined) === (seasonId !== undefined)) throw new BadRequestException();
    const target: EntryTarget = mediaId !== undefined ? { mediaId } : { seasonId: seasonId! };
    await this.media.resolveTarget(target);
    const data = changes(input, null);
    try {
      return await this.db.$transaction(async tx => {
        const row = await tx.watchEntry.create({ data: { userId, ...target, ...data }, select: entrySelect });
        await this.activity.recordChanges(tx, null, row);
        return entryView(row);
      });
    } catch (error) { if (isUniqueConflict(error)) throw new ConflictException(); throw error; }
  }
  async get(viewerId: string, id: string): Promise<EntryView> {
    // Authorize against ownership alone before loading any private content.
    const owner = await this.db.watchEntry.findUnique({ where: { id }, select: { userId: true } });
    if (!owner) throw new NotFoundException();
    await this.access.assertCanRead(viewerId, owner.userId);
    const row = await this.db.watchEntry.findUnique({ where: { id }, select: entrySelect });
    if (!row) throw new NotFoundException();
    return entryView(row);
  }
  async update(userId: string, id: string, input: EntryUpdateInput): Promise<EntryView> {
    return this.db.$transaction(async tx => {
      // Lock only an owned row before reading state. Retries observe the committed
      // predecessor and cannot duplicate events or overwrite unrelated edits.
      const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WatchEntry" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      if (!owned.length) throw new NotFoundException();
      const before = await tx.watchEntry.findUniqueOrThrow({ where: { id }, select: entrySelect });
      const data = changes(input, before);
      if (data.status === before.status && String(data.rating) === String(before.rating) && data.review === before.review && data.completedAt?.getTime() === before.completedAt?.getTime()) return entryView(before);
      const after = await tx.watchEntry.update({ where: { id }, data, select: entrySelect });
      await this.activity.recordChanges(tx, before, after);
      return entryView(after);
    });
  }
  async delete(userId: string, id: string): Promise<void> {
    // The FK cascades activity deletion in this same database operation.
    const result = await this.db.watchEntry.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException();
  }
  async list(viewerId: string, ownerId: string, query: EntryListQuery): Promise<Page<EntryView>> {
    await this.access.assertCanRead(viewerId, ownerId);
    if (query.mediaId !== undefined && query.seasonId !== undefined) throw new BadRequestException();
    if (query.ratingMin !== undefined && query.ratingMax !== undefined && query.ratingMin > query.ratingMax || query.from && query.to && query.from > query.to) throw new BadRequestException();
    const where: Prisma.WatchEntryWhereInput = {
      userId: ownerId, status: query.status, mediaId: query.mediaId, seasonId: query.seasonId,
      ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      ...(query.genre ? { OR: [{ media: { genres: { has: query.genre } } }, { season: { media: { genres: { has: query.genre } } } }] } : {}),
      ...(query.ratingMin !== undefined || query.ratingMax !== undefined ? { rating: { not: null, gte: query.ratingMin, lte: query.ratingMax } } : {}),
      ...(query.from || query.to ? { completedAt: { not: null, ...(query.from ? { gte: calendarDate(query.from)! } : {}), ...(query.to ? { lte: calendarDate(query.to)! } : {}) } } : {}),
    };
    const rows = await this.db.watchEntry.findMany({ where, select: entrySelect, orderBy: { id: 'asc' }, take: query.limit + 1 });
    return { items: rows.slice(0, query.limit).map(entryView), nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null };
  }
}

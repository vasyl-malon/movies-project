import { Injectable } from '@nestjs/common';
import type { Prisma, WatchEntry, ActivityType } from '../../generated/prisma/client.js';

/** Receives the entry transaction; events never commit separately from the write. */
@Injectable()
export class ActivityWriter {
  async recordChanges(tx: Prisma.TransactionClient, before: WatchEntry | null, after: WatchEntry): Promise<void> {
    const types: ActivityType[] = [];
    if (!before || before.status !== after.status) types.push('STATUS');
    if (before && before.rating?.toString() !== after.rating?.toString()) types.push('RATING');
    if (before && before.review !== after.review) types.push('REVIEW');
    if (types.length) await tx.activity.createMany({ data: types.map(type => ({ actorId: after.userId, entryId: after.id, type })) });
  }
}

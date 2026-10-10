import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ActivityView, Page } from '@tracker/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { entrySelect, entryView } from '../entries/entry.view.js';
import { profileView, publicProfileSelect } from '../profiles/profiles.service.js';

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}
function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error();
    const [timestamp, id] = decoded as unknown[];
    if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || timestamp.startsWith('0000') || typeof id !== 'string' || !isUUID(id)) throw new Error();
    const createdAt = new Date(timestamp);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== timestamp || encodeCursor(createdAt, id) !== value) throw new Error();
    return { createdAt, id };
  } catch { throw new BadRequestException(); }
}
@Injectable()
export class ActivityService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async feed(viewerId: string, query: { limit: number; cursor?: string }): Promise<Page<ActivityView>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    return this.db.$transaction(async tx => {
      // Authorize the current entry owner before pagination. Matching actor/owner
      // prevents even a corrupt activity reference from exposing a stranger entry.
      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT a.id FROM "Activity" a
        JOIN "WatchEntry" e ON e.id = a."entryId" AND e."userId" = a."actorId"
        JOIN "Friendship" f ON f.status = 'ACCEPTED' AND
          ((f."userLowId" = ${viewerId} AND f."userHighId" = e."userId") OR
           (f."userHighId" = ${viewerId} AND f."userLowId" = e."userId"))
        WHERE e."userId" <> ${viewerId}
        ${cursor ? Prisma.sql`AND (a."createdAt" < ${cursor.createdAt} OR (a."createdAt" = ${cursor.createdAt} AND a.id < ${cursor.id}))` : Prisma.empty}
        ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${query.limit + 1}`);
      if (!ids.length) return { items: [], nextCursor: null };
      // The same repeatable-read snapshot keeps authorization and current content
      // consistent without loading any authentication fields or history payloads.
      const rows = await tx.activity.findMany({ where: { id: { in: ids.map(row => row.id) } },
        select: { id: true, type: true, createdAt: true, actor: { select: publicProfileSelect }, entry: { select: entrySelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1)!;
      return {
        items: page.map(row => ({ id: row.id, actor: profileView(row.actor), entry: entryView(row.entry), type: row.type, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > query.limit ? encodeCursor(last.createdAt, last.id) : null,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}

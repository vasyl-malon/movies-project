import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CommunityRating, EntryTarget } from '@tracker/contracts';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class CommunityService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async rating(target: EntryTarget): Promise<CommunityRating> {
    const exists = target.mediaId !== undefined
      ? await this.db.media.findUnique({ where: { id: target.mediaId }, select: { id: true } })
      : await this.db.season.findUnique({ where: { id: target.seasonId }, select: { id: true } });
    if (!exists) throw new NotFoundException();
    // Unique user/target constraints guarantee one eligible contribution per user.
    // Count and average use one database aggregate over current entries.
    const aggregate = await this.db.watchEntry.aggregate({ where: { ...target, status: 'WATCHED', rating: { not: null } }, _count: { rating: true }, _avg: { rating: true } });
    return aggregate._count.rating < 3 ? { average: null, count: null }
      : { average: Number(aggregate._avg.rating!.toFixed(1)), count: aggregate._count.rating };
  }
}

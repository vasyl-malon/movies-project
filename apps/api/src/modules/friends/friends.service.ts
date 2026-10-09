import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FriendRequestView, Page, ProfileView } from '@tracker/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { isUniqueConflict, profileView, publicProfileSelect } from '../profiles/profiles.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
export interface PageInput { limit?: number; cursor?: string }
const participant = (userId: string): Prisma.FriendshipWhereInput => ({ OR: [{ userLowId: userId }, { userHighId: userId }] });
@Injectable()
export class FriendsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(RateLimitService) private readonly limits: RateLimitService) {}
  async requests(userId: string, page: PageInput): Promise<Page<FriendRequestView>> {
    const limit = page.limit ?? 20;
    const rows = await this.db.friendship.findMany({ where: { ...participant(userId), status: 'PENDING', ...(page.cursor ? { id: { gt: page.cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, requesterId: true, userLow: { select: publicProfileSelect }, userHigh: { select: publicProfileSelect } } });
    return { items: rows.slice(0, limit).map(row => ({ id: row.id, requester: profileView(row.requesterId === row.userLow.id ? row.userLow : row.userHigh), recipient: profileView(row.requesterId === row.userLow.id ? row.userHigh : row.userLow) })), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }
  async friends(userId: string, page: PageInput): Promise<Page<ProfileView>> {
    const limit = page.limit ?? 20;
    const rows = await this.db.user.findMany({ where: { ...(page.cursor ? { id: { gt: page.cursor } } : {}), OR: [{ lowFriendships: { some: { status: 'ACCEPTED', userHighId: userId } } }, { highFriendships: { some: { status: 'ACCEPTED', userLowId: userId } } }] }, select: publicProfileSelect, orderBy: { id: 'asc' }, take: limit + 1 });
    return { items: rows.slice(0, limit).map(profileView), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }
  async send(userId: string, recipientId: string): Promise<FriendRequestView> {
    if (!await this.limits.consume(`friend-send:${userId}`, 10, 3600)) throw new HttpException('Too many requests', 429);
    if (userId === recipientId) throw new BadRequestException();
    const recipient = await this.db.user.findUnique({ where: { id: recipientId }, select: publicProfileSelect });
    if (!recipient) throw new NotFoundException();
    const [userLowId, userHighId] = [userId, recipientId].sort() as [string, string];
    try {
      const row = await this.db.friendship.create({ data: { userLowId, userHighId, requesterId: userId }, select: { id: true, userLow: { select: publicProfileSelect }, userHigh: { select: publicProfileSelect } } });
      return { id: row.id, requester: profileView(row.userLow.id === userId ? row.userLow : row.userHigh), recipient: profileView(recipient) };
    } catch (error) { if (isUniqueConflict(error)) throw new ConflictException(); throw error; }
  }
  async accept(userId: string, id: string): Promise<{ id: string }> {
    await this.db.$transaction(async tx => {
      const result = await tx.friendship.updateMany({ where: { id, status: 'PENDING', requesterId: { not: userId }, ...participant(userId) }, data: { status: 'ACCEPTED' } });
      if (!result.count) throw new NotFoundException();
    });
    return { id };
  }
  async dismiss(userId: string, id: string): Promise<void> {
    await this.db.$transaction(async tx => {
      const result = await tx.friendship.deleteMany({ where: { id, status: 'PENDING', ...participant(userId) } });
      if (!result.count) throw new NotFoundException();
    });
  }
  async remove(userId: string, otherId: string): Promise<void> {
    const [userLowId, userHighId] = [userId, otherId].sort() as [string, string];
    await this.db.$transaction(async tx => {
      const result = await tx.friendship.deleteMany({ where: { userLowId, userHighId, status: 'ACCEPTED' } });
      if (!result.count) throw new NotFoundException();
    });
  }
}

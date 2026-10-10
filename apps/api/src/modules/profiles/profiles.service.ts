import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRESET_AVATARS, type ProfileView } from '@tracker/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const publicProfileSelect = { id: true, username: true, name: true, avatar: true } as const;
type PublicProfile = Prisma.UserGetPayload<{ select: typeof publicProfileSelect }>;
export function profileView(user: PublicProfile): ProfileView {
  return { id: user.id, username: user.username, displayName: user.name,
    avatar: PRESET_AVATARS.includes(user.avatar as typeof PRESET_AVATARS[number]) ? user.avatar! : 'default' };
}
export function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
@Injectable()
export class ProfilesService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(RateLimitService) private readonly limits: RateLimitService) {}
  async me(userId: string): Promise<ProfileView> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: publicProfileSelect });
    if (!user) throw new NotFoundException();
    return profileView(user);
  }
  async discover(viewerId: string, username: string): Promise<ProfileView> {
    if (!await this.limits.consume(`profile-discovery:${viewerId}`, 30, 60)) throw new HttpException('Too many requests', 429);
    // Prisma's insensitive equality uses ILIKE; underscores must remain literal.
    const [user] = await this.db.$queryRaw<PublicProfile[]>`
      SELECT id, username, name, avatar FROM "User"
      WHERE lower(username) = lower(${username}) LIMIT 1`;
    if (!user) throw new NotFoundException();
    return profileView(user);
  }
  async update(userId: string, input: { username?: string; displayName?: string; avatar?: string }): Promise<ProfileView> {
    try {
      return profileView(await this.db.user.update({ where: { id: userId },
        data: { ...(input.username !== undefined ? { username: input.username } : {}), ...(input.displayName !== undefined ? { name: input.displayName } : {}), ...(input.avatar !== undefined ? { avatar: input.avatar } : {}) }, select: publicProfileSelect }));
    } catch (error) { if (isUniqueConflict(error)) throw new ConflictException(); throw error; }
  }
}

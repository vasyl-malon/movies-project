import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
@Injectable()
export class PrivateAccessService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async assertCanRead(viewerId: string, ownerId: string): Promise<void> {
    if (viewerId === ownerId) {
      if (await this.db.user.findUnique({ where: { id: ownerId }, select: { id: true } })) return;
    } else {
      const [userLowId, userHighId] = [viewerId, ownerId].sort() as [string, string];
      if (await this.db.friendship.findFirst({ where: { userLowId, userHighId, status: 'ACCEPTED' }, select: { id: true } })) return;
    }
    throw new ForbiddenException();
  }
}

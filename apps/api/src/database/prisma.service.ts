import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Optional() adapter?: PrismaPg) {
    const connectionString = process.env.DATABASE_URL;
    if (!adapter && !connectionString) throw new Error('DATABASE_URL is required for database access');
    super({ adapter: adapter ?? new PrismaPg({ connectionString: connectionString! }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class RateLimitService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" (id, key, count, "lastRequest")
      VALUES (${randomUUID()}, ${key}, 1, floor(extract(epoch FROM clock_timestamp()))::bigint)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN "RateLimit"."lastRequest" <= floor(extract(epoch FROM clock_timestamp()))::bigint - ${windowSeconds}
                     THEN 1 ELSE "RateLimit".count + 1 END,
        "lastRequest" = CASE WHEN "RateLimit"."lastRequest" <= floor(extract(epoch FROM clock_timestamp()))::bigint - ${windowSeconds}
                             THEN floor(extract(epoch FROM clock_timestamp()))::bigint ELSE "RateLimit"."lastRequest" END
      RETURNING count`;
    return rows[0]!.count <= limit;
  }
}

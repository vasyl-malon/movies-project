import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ApiConfig } from '../../config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailModule } from '../email/email.module.js';
import { EmailService } from '../email/email.service.js';
import { AUTH, createAuth } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './session.guard.js';
import { RateLimitService } from '../../common/rate-limit.service.js';

@Module({})
export class AuthModule {
  static register(config: ApiConfig): DynamicModule {
    return { module: AuthModule, imports: [EmailModule.register(config)], controllers: [AuthController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(new PrismaPg({ connectionString: config.databaseUrl })) },
        { provide: AUTH, useFactory: (db: PrismaService, email: EmailService) => createAuth(config, db, email), inject: [PrismaService, EmailService] },
        RateLimitService, SessionGuard,
      ], exports: [AUTH, SessionGuard] };
  }
}

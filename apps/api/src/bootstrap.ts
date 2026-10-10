import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { FriendsModule } from './modules/friends/friends.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { EntriesModule } from './modules/entries/entries.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { CommunityModule } from './modules/community/community.module.js';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './common/http-errors.js';
import { createValidationPipe } from './common/validation.js';
import type { ApiConfig } from './config.js';

export function configureApplication(app: INestApplication, config: ApiConfig): void {
  app.use(['/api/media', '/api/entries', '/api/users', '/api/feed', '/api/community'], (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
}

export async function createApplication(config: ApiConfig): Promise<INestApplication> {
  @Module({ imports: [AppModule, AuthModule.register(config), ProfilesModule, FriendsModule, MediaModule.register(config.omdbApiKey), EntriesModule, ActivityModule, CommunityModule] })
  class RuntimeModule {}
  const app = await NestFactory.create(RuntimeModule, { logger: false, abortOnError: false });
  configureApplication(app, config);
  return app;
}

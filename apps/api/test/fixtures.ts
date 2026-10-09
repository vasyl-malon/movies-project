import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../dist/generated/prisma/client.js';
import { AppModule } from '../dist/app.module.js';
import { configureApplication } from '../dist/bootstrap.js';

import { validateEnvironment } from '../dist/config.js';

/** Shape-valid placeholders; these fixtures make no external connections. */
export const testConfig = validateEnvironment({
  DATABASE_URL: 'postgresql://tracker:local-placeholder@localhost:5432/tracker_test',
  BETTER_AUTH_SECRET: 'test-placeholder-secret-at-least-32-characters',
  OMDB_API_KEY: 'test-placeholder-key',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test',
});


export function createTestDatabase(): PrismaClient {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) {
    throw new Error('Use a dedicated TEST_DATABASE_URL whose database name ends in _test');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export async function resetDatabase(db: PrismaClient): Promise<void> {
  // Verify the actual connected database before destructive test cleanup.
  const [row] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!row?.name.endsWith('_test')) throw new Error('Refusing to reset a non-test database');
  await db.$executeRawUnsafe('TRUNCATE "User", "Media", "RateLimit", "MediaCache", "Verification" CASCADE');
}

export function createUser(db: PrismaClient, data: Partial<Prisma.UserCreateInput> = {}) {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `${id}@example.test`, username: id, name: 'Test User', ...data } });
}

export function createMedia(db: PrismaClient, data: Partial<Prisma.MediaCreateInput> = {}) {
  return db.media.create({ data: { imdbId: `tt${randomUUID()}`, type: 'SERIES', title: 'Test Series', ...data } });
}

export function createSeason(db: PrismaClient, mediaId: string, seasonNumber = 1) {
  return db.season.create({ data: { mediaId, seasonNumber } });
}

export async function createTestApp() {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  configureApplication(app, testConfig);
  await app.init();
  return app;
}

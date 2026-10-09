import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
// Explicit release/test configuration takes precedence and avoids reading local secrets.
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation/build requires no live database. Migration commands require DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});

import { validateEnvironment } from '../dist/config.js';

/** Shape-valid placeholders; these fixtures make no external connections. */
export const testConfig = validateEnvironment({
  DATABASE_URL: 'postgresql://tracker:local-placeholder@localhost:5432/tracker_test',
  BETTER_AUTH_SECRET: 'test-placeholder-secret-at-least-32-characters',
  OMDB_API_KEY: 'test-placeholder-key',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test',
});

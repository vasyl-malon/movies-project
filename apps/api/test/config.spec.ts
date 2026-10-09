import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../dist/config.js';

const valid = {
  DATABASE_URL: 'postgresql://tracker:local-placeholder@localhost:5432/tracker',
  BETTER_AUTH_SECRET: 'test-placeholder-secret-at-least-32-characters',
  OMDB_API_KEY: 'test-placeholder-key',
  FRONTEND_ORIGIN: 'http://localhost:3000',
};

describe('backend configuration', () => {
  it('accepts service configuration without connecting to services', () => {
    expect(validateEnvironment(valid)).toMatchObject({ port: 3001, nodeEnv: 'development', frontendOrigin: 'http://localhost:3000' });
  });

  it.each(['DATABASE_URL', 'BETTER_AUTH_SECRET', 'OMDB_API_KEY', 'FRONTEND_ORIGIN'])('names missing %s without revealing other secrets', (key) => {
    try {
      validateEnvironment({ ...valid, [key]: undefined });
      expect.fail('Expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(key);
      expect((error as Error).message).not.toContain(valid.BETTER_AUTH_SECRET);
      expect((error as Error).message).not.toContain(valid.DATABASE_URL);
    }
  });

  it.each([
    ['DATABASE_URL', 'https://invalid.example'],
    ['DATABASE_URL', 'postgresql://localhost'],
    ['BETTER_AUTH_SECRET', 'short-placeholder'],
    ['OMDB_API_KEY', ' '],
    ['FRONTEND_ORIGIN', 'https://example.com/private'],
    ['FRONTEND_ORIGIN', 'https://user:placeholder@example.com'],
    ['FRONTEND_ORIGIN', 'file:///tmp'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '3001.5'],
    ['NODE_ENV', 'unknown'],
  ])('rejects invalid %s safely', (key, value) => {
    expect(() => validateEnvironment({ ...valid, [key]: value })).toThrow(key);
    try { validateEnvironment({ ...valid, [key]: value }); }
    catch (error) { if (value.trim()) expect((error as Error).message).not.toContain(value); }
  });

  it('accepts an explicit port and HTTPS trusted origin', () => {
    expect(validateEnvironment({ ...valid, PORT: '4100', NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://tracker.example' })).toMatchObject({ port: 4100, nodeEnv: 'production', frontendOrigin: 'https://tracker.example' });
  });
});

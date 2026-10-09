import { afterEach, expect, it, vi } from 'vitest';
vi.mock('node:fs', async importActual => ({ ...await importActual<typeof import('node:fs')>(), existsSync: () => true }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('uses explicit isolated DATABASE_URL without reading the root env file', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1/tracker_config_test');
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => { throw new Error('Root env file must not be read'); });
  const { default: config } = await import('../prisma.config.js');
  expect(config.datasource?.url).toBe('postgresql://127.0.0.1/tracker_config_test');
});

import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', fullyParallel: false, workers: 1, timeout: 60000, expect: { timeout: 10000 }, use: { baseURL: process.env.E2E_BASE_URL, browserName: 'chromium', trace: 'retain-on-failure' }, reporter: [['list'], ['html', { open: 'never' }]] });

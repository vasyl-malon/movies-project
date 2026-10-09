import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { fileParallelism: false, include: ['test/**/*.spec.ts'], environment: 'node' },
});

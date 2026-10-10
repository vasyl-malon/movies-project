import { fileURLToPath, URL } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/next-env.d.ts', '**/coverage/**', '**/playwright-report/**', '**/test-results/**', '**/src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly' } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': next, 'react-hooks': reactHooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
    settings: { next: { rootDir: fileURLToPath(new URL('./apps/web/', import.meta.url)) } },
  },
);

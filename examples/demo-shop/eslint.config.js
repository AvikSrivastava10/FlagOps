import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['api/**/*.ts', '*.{js,ts}', 'web/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
);

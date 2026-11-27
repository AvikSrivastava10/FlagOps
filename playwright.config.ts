import { defineConfig, devices } from '@playwright/test';

// Specs save their screenshots under .agents/screenshots/<stage>/, which git ignores.
export default defineConfig({
  testDir: 'apps/web/e2e',
  testIgnore: ['**/.agents/**', '**/docs/**', '**/examples/**', '**/data/**', '**/.worktrees/**'],
  reporter: 'list',
  use: { headless: true },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'narrow',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});

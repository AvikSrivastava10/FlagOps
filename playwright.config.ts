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
  webServer: [
    {
      // gallery.spec.ts: the component gallery exists only in the Vite dev server, because the
      // production build (and so `vite preview`) has index.html as its only page.
      command: 'pnpm --filter @flagops/web exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174/gallery.html',
      reuseExistingServer: !process.env['CI'],
    },
  ],
});

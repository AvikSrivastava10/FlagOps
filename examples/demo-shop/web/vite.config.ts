import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    // Loads jsdom once per worker instead of once per test file; each file still runs isolated.
    pool: 'vmThreads',
    setupFiles: ['./test/setup.ts'],
  },
});

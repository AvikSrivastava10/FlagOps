import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    // A test's first request loads Fastify's request handling, which takes seconds on a cold disk.
    testTimeout: 30_000,
  },
});

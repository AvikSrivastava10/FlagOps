import { defineConfig } from 'vitest/config';

/** No test run collects from these (structure.md section 4). */
const excluded = [
  '**/node_modules/**',
  '**/dist/**',
  '.agents/**',
  'docs/**',
  'examples/**',
  'data/**',
  '.worktrees/**',
];

// `pnpm test` runs the offline suites only. Live, acceptance and demo-golden suites run through
// vitest.live.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          // The first Fastify app a worker builds loads Fastify, its plugins and the route
          // schemas; on a busy Windows machine that alone took 3 to 15 seconds.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          include: [
            'apps/server/src/**/*.test.ts',
            'apps/server/test/*.test.ts',
            'apps/server/test/http/**/*.test.ts',
          ],
          // Fixture inputs stand for other repositories' code; demo-golden installs packages.
          exclude: [
            ...excluded,
            'apps/server/test/fixtures/**',
            'apps/server/test/demo-golden.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          exclude: excluded,
        },
      },
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['packages/shared/src/**/*.test.ts'],
          exclude: excluded,
        },
      },
    ],
  },
});

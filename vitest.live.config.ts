import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
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

// Live suites read the same .env as the server: Flagsmith, GitHub and the E2E sign-in.
const envFile = new URL('./.env', import.meta.url);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};

const minute = 60_000;

export default defineConfig({
  test: {
    env,
    // The suites share one Flagsmith organisation and one GitHub repository, so files run one at a time.
    fileParallelism: false,
    exclude: excluded,
    testTimeout: 2 * minute,
    hookTimeout: 5 * minute,
    projects: [
      { test: { name: 'live', include: ['apps/server/test/live/**/*.live.test.ts'] } },
      {
        test: { name: 'live-github', include: ['apps/server/test/live/**/*.live-github.test.ts'] },
      },
      {
        test: {
          name: 'acceptance',
          include: ['apps/server/test/acceptance/**/*.test.ts'],
          testTimeout: 15 * minute,
        },
      },
      {
        test: {
          name: 'demo-golden',
          include: ['apps/server/test/demo-golden.test.ts'],
          testTimeout: 15 * minute,
        },
      },
    ],
  },
});

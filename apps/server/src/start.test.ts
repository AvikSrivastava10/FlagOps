import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeOrganisationKey } from '../test/helpers/fake-flagsmith.js';
import { FakeGitHub } from '../test/helpers/fake-github.js';
import { captureLogs } from '../test/helpers/log-capture.js';
import { seeder } from '../test/helpers/seeded-fake.js';
import { loadConfig, type Config } from './config/load.js';
import { createLogger } from './logger.js';
import { start, type RunningServer } from './start.js';

let dataDir: string;
let server: RunningServer | undefined;

/** Flagsmith refusing the test's organisation key, so the first sync fails at once and offline. */
const refusingFlagsmith = async (): Promise<Response> =>
  Response.json({ detail: 'Invalid API key.' }, { status: 401 });

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-start-'));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

/** A config for a test server on a free loopback port. */
function testConfig(env: NodeJS.ProcessEnv): Config {
  const config = loadConfig({
    FLAGSMITH_ORG_API_KEY: 'test-organisation-key-0001',
    FLAGOPS_DATA_DIR: dataDir,
    FLAGOPS_BIND: '127.0.0.1',
    ...env,
  });
  return { ...config, http: { ...config.http, port: 0 } };
}

describe('start', () => {
  it('logs the Docker rewrite of the Flagsmith URL once, with both URLs', async () => {
    const logs = captureLogs();
    server = await start(
      testConfig({ FLAGSMITH_URL: 'http://localhost:8000', FLAGOPS_IN_DOCKER: '1' }),
      createLogger('info', logs.destination),
      { fetch: refusingFlagsmith },
    );
    await server.app.inject('/api/health');
    await server.app.inject('/api/health');

    const rewrites = logs.entries().filter((entry) => 'requestUrl' in entry);
    expect(rewrites).toEqual([
      expect.objectContaining({
        level: 30,
        flagsmithUrl: 'http://localhost:8000',
        requestUrl: 'http://host.docker.internal:8000',
      }),
    ]);
  });

  it('logs no rewrite outside Docker', async () => {
    const logs = captureLogs();
    server = await start(
      testConfig({ FLAGSMITH_URL: 'http://localhost:8000' }),
      createLogger('info', logs.destination),
      { fetch: refusingFlagsmith },
    );

    expect(logs.entries().filter((entry) => 'requestUrl' in entry)).toEqual([]);
  });

  it('creates and migrates the database in the data directory, then serves the API', async () => {
    const logs = captureLogs();
    server = await start(
      testConfig({ FLAGSMITH_URL: 'http://localhost:8000' }),
      createLogger('info', logs.destination),
      { fetch: refusingFlagsmith },
    );
    const response = await fetch(`http://127.0.0.1:${portOf(server)}/api/health`);

    expect(existsSync(path.join(dataDir, 'flagops.db'))).toBe(true);
    expect(logs.entries()).toContainEqual(expect.objectContaining({ migration: '0001_base.sql' }));
    expect(response.status).toBe(200);
  });

  it('scans the tracked repositories after the first sync and uploads them to Code References', async () => {
    const run = seeder();
    await run.seed();
    const github = await FakeGitHub.start();
    github.addRepository('acme/shop', {
      files: {
        'package.json': '{ "dependencies": { "@flagsmith/nodejs": "9.5.0" } }\n',
        'src/checkout.ts':
          "export const isNew = (flags) => flags.isFeatureEnabled('new_checkout');\n",
      },
    });
    try {
      server = await start(
        testConfig({
          FLAGSMITH_URL: 'http://flagsmith.test',
          FLAGSMITH_ORG_API_KEY: fakeOrganisationKey,
          GITHUB_TOKEN: github.token,
          GITHUB_REPOSITORIES: 'acme/shop',
        }),
        createLogger('error', captureLogs().destination),
        { fetch: run.fake.fetch, githubBaseUrl: github.url },
      );

      // The sync job requests the scan when it finishes; wait for the upload it leads to.
      await vi.waitFor(
        () => {
          expect(run.fake.state.codeReferenceScans).toHaveLength(1);
        },
        { timeout: 20_000, interval: 20 },
      );
      expect(run.fake.state.codeReferenceScans[0]).toMatchObject({
        repositoryUrl: 'https://github.com/acme/shop',
        revision: github.head('acme/shop'),
        references: [
          { feature_name: 'new_checkout', file_path: 'src/checkout.ts', line_number: 1 },
        ],
      });
    } finally {
      await server?.close();
      server = undefined;
      await github.close();
    }
  });
});

function portOf(running: RunningServer): number {
  const address = running.app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server is not listening on a TCP port');
  }
  return address.port;
}

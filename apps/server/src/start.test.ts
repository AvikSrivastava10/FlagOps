import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '../test/helpers/log-capture.js';
import { loadConfig, type Config } from './config/load.js';
import { createLogger } from './logger.js';
import { start, type RunningServer } from './start.js';

let dataDir: string;
let server: RunningServer | undefined;

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
    );

    expect(logs.entries().filter((entry) => 'requestUrl' in entry)).toEqual([]);
  });

  it('creates and migrates the database in the data directory, then serves the API', async () => {
    const logs = captureLogs();
    server = await start(
      testConfig({ FLAGSMITH_URL: 'http://localhost:8000' }),
      createLogger('info', logs.destination),
    );
    const response = await fetch(`http://127.0.0.1:${portOf(server)}/api/health`);

    expect(existsSync(path.join(dataDir, 'flagops.db'))).toBe(true);
    expect(logs.entries()).toContainEqual(expect.objectContaining({ migration: '0001_base.sql' }));
    expect(response.status).toBe(200);
  });
});

function portOf(running: RunningServer): number {
  const address = running.app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server is not listening on a TCP port');
  }
  return address.port;
}

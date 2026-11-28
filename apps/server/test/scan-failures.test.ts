import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readDemoShopFiles } from '../src/cli/demo-publish.js';
import { Secret } from '../src/config/secret.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { latestScan, latestSuccessfulScan } from '../src/db/repos/scans.js';
import { keyOrganisationResolver } from '../src/flagsmith/projects.js';
import { createGitHubClient } from '../src/github/client.js';
import { createInventoryStore } from '../src/inventory/store.js';
import { createInventorySync } from '../src/inventory/sync.js';
import { createLogger } from '../src/logger.js';
import { matchRepository } from '../src/matcher/match-repository.js';
import { createScanService, type ScanService } from '../src/scanner/scan.js';
import { FakeGitHub } from './helpers/fake-github.js';
import { fakeClient, organisationKey } from './helpers/flagsmith-client.js';
import { captureLogs } from './helpers/log-capture.js';
import { seeder } from './helpers/seeded-fake.js';

// A bug in the middle of a GitHub outage, with two tracked repositories (architecture.md 18.2,
// D-094): the matcher, wrapped so a test can make it throw, fails on the first repository's new
// commit right after its head check had failed. `spy: true` keeps the real implementations.
vi.mock('../src/matcher/match-repository.js', { spy: true });

const first = 'AvikSrivastava10/flagops-demo-shop';
const second = 'AvikSrivastava10/flagops-second-shop';
const run = seeder();
const { client } = fakeClient(run.fake);
const inventory = createInventoryStore();
const logs = captureLogs();
const logger = createLogger('info', logs.destination);
const errorLevel = 50;
let github: FakeGitHub;
let dataDir: string;
let db: Db;
let scans: ScanService;
let demoFiles: Record<string, string>;

/** Gives the fake repository a new head commit, with one more README line. */
function pushCommit(repository: string, line: string): void {
  const readme = `${demoFiles['README.md'] ?? ''}\n${line}\n`;
  github.addRepository(repository, { files: { ...demoFiles, 'README.md': readme } });
}

function scanAfterSync(): Promise<void> {
  scans.requestAll();
  return scans.run();
}

function errorsLoggedSince(mark: number): Record<string, unknown>[] {
  return logs
    .entries()
    .slice(mark)
    .filter((entry) => entry.level === errorLevel);
}

function failMatcherOnce(): void {
  vi.mocked(matchRepository).mockImplementationOnce(() => {
    throw new Error('matcher bug on this commit');
  });
}

beforeAll(async () => {
  await run.seed();
  await createInventorySync({
    client,
    credential: organisationKey,
    keyOrganisation: keyOrganisationResolver(client, organisationKey),
    projectId: undefined,
    store: inventory,
    logger,
  }).run();
  demoFiles = Object.fromEntries(
    (await readDemoShopFiles()).map((file) => [file.path, file.content]),
  );
  github = await FakeGitHub.start();
  github.addRepository(first, { files: demoFiles });
  github.addRepository(second, { files: demoFiles });
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-scan-failures-'));
  db = openDatabase(dataDir);
  migrate(db);
  scans = createScanService({
    db,
    github: createGitHubClient({
      token: new Secret(github.token),
      repositories: [first, second],
      baseUrl: github.url,
      contentIntervalMs: 0,
      retryDelaysMs: [1, 1],
    }),
    repositories: [first, second],
    flagsmith: client,
    credential: organisationKey,
    inventory,
    logger,
  });
  await scanAfterSync();
}, 60_000);

afterAll(async () => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  await github.close();
});

describe('a bug in the middle of an outage', () => {
  it('is stored as an internal_error, logged once with its stack, and the run goes on with the next repository', async () => {
    pushCommit(first, 'A commit made during the outage.');
    github.failNext(
      { path: /\/repos\/AvikSrivastava10\/flagops-demo-shop\/git\/ref\/heads\// },
      { status: 401, body: { message: 'Bad credentials' } },
    );
    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'github_bad_credentials' });
    const mark = logs.entries().length;
    pushCommit(second, 'A commit in the second repository.');
    failMatcherOnce();

    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'internal_error' });

    expect(latestScan(db, first)).toMatchObject({
      outcome: 'failed',
      commitSha: github.head(first),
      errorCode: 'internal_error',
      errorMessage: `Scanning ${first} failed unexpectedly. The FlagOps log has the details.`,
    });
    expect(latestSuccessfulScan(db, second)?.commitSha).toBe(github.head(second));
    const errors = errorsLoggedSince(mark);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      msg: `Scan of ${first} failed`,
      repository: first,
      err: { stack: expect.stringContaining('matcher bug on this commit') as unknown },
    });

    failMatcherOnce();
    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'internal_error' });
    expect(errorsLoggedSince(mark)).toHaveLength(1);

    await scanAfterSync();
    expect(latestScan(db, first)).toMatchObject({
      outcome: 'succeeded',
      commitSha: github.head(first),
    });
  });
});

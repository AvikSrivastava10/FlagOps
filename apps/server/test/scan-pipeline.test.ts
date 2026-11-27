import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDemoShopFiles } from '../src/cli/demo-publish.js';
import { Secret } from '../src/config/secret.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { listAddedOwners, replaceOwnerMappings } from '../src/db/repos/owners.js';
import { latestScan, latestSuccessfulScan, scanRecords } from '../src/db/repos/scans.js';
import { keyOrganisationResolver } from '../src/flagsmith/projects.js';
import { createGitHubClient } from '../src/github/client.js';
import { createInventoryStore } from '../src/inventory/store.js';
import { createInventorySync } from '../src/inventory/sync.js';
import { createLogger } from '../src/logger.js';
import { createScanService, type ScanService } from '../src/scanner/scan.js';
import { FakeGitHub } from './helpers/fake-github.js';
import { fakeClient, organisationKey } from './helpers/flagsmith-client.js';
import { captureLogs } from './helpers/log-capture.js';
import { seeder } from './helpers/seeded-fake.js';

// The scan pipeline on the demo shop's tarball, built from examples/demo-shop and served by the
// fake GitHub, against the seeded fake Flagsmith (plan S4.1-S4.4, offline parts).

const repository = 'AvikSrivastava10/flagops-demo-shop';
const operator = 7;
const run = seeder();
const { client } = fakeClient(run.fake);
const inventory = createInventoryStore();
const logs = captureLogs();
const logger = createLogger('info', logs.destination);
let github: FakeGitHub;
let dataDir: string;
let db: Db;
let scans: ScanService;
let demoFiles: Record<string, string>;

const sync = createInventorySync({
  client,
  credential: organisationKey,
  keyOrganisation: keyOrganisationResolver(client, organisationKey),
  projectId: undefined,
  store: inventory,
  logger,
});

function flagId(name: string): number {
  const feature = run.fake.state.features.find((item) => item.name === name);
  if (feature === undefined) {
    throw new Error(`no flag ${name}`);
  }
  return feature.id;
}

function ownersOf(name: string): number[] {
  return run.fake.state.owners
    .filter((owner) => owner.feature === flagId(name) && owner.kind === 'user')
    .map((owner) => owner.id);
}

/** Gives the fake repository a new head commit that holds `files`. */
function pushFiles(files: Record<string, string>): void {
  github.addRepository(repository, { files });
}

/** What the sync job does after each sync: every tracked repository gets its head check. */
function scanAfterSync(): Promise<void> {
  scans.requestAll();
  return scans.run();
}

const info = 30;
const warn = 40;

/** The messages logged at `level` since the log held `from` entries. */
function messages(level: number, from: number): string[] {
  return logs
    .entries()
    .slice(from)
    .filter((entry) => entry.level === level)
    .map((entry) => String(entry.msg));
}

/** How many scans of each outcome the repository keeps. */
function scanOutcomes(): Record<string, number> {
  const rows = db
    .prepare<[string], { outcome: string; count: number }>(
      'SELECT outcome, COUNT(*) AS count FROM scans WHERE repository = ? GROUP BY outcome',
    )
    .all(repository);
  return Object.fromEntries(rows.map((row) => [row.outcome, row.count]));
}

function tarballDownloads(): number {
  return github.requests.filter((request) => request.path.includes('/tarball/')).length;
}

function addOwnerRequests(): number {
  return run.fake.requests.filter((request) => request.path.endsWith('/add-owners/')).length;
}

/** Someone removes the operator as owner of new_checkout in Flagsmith's dashboard. */
function removeOperatorFromNewCheckout(): void {
  run.fake.state.owners = run.fake.state.owners.filter(
    (owner) =>
      !(owner.feature === flagId('new_checkout') && owner.kind === 'user' && owner.id === operator),
  );
}

beforeAll(async () => {
  await run.seed();
  run.fake.state.users.push({
    id: operator,
    email: 'operator@example.com',
    password: 'not used',
    firstName: 'Demo',
    lastName: 'Operator',
    roles: { 1: 'ADMIN' },
  });
  await sync.run();
  demoFiles = Object.fromEntries(
    (await readDemoShopFiles()).map((file) => [file.path, file.content]),
  );
  github = await FakeGitHub.start();
  pushFiles(demoFiles);
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-scan-'));
  db = openDatabase(dataDir);
  migrate(db);
  scans = createScanService({
    db,
    github: createGitHubClient({
      token: new Secret(github.token),
      repositories: [repository],
      baseUrl: github.url,
      contentIntervalMs: 0,
      retryDelaysMs: [1, 1],
    }),
    repositories: [repository],
    flagsmith: client,
    credential: organisationKey,
    inventory,
    logger,
  });
}, 60_000);

afterAll(async () => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  await github.close();
});

describe('the scan pipeline on the demo shop', () => {
  it('scans the head commit, stores the records and uploads the references to Code References', async () => {
    await scanAfterSync();

    const scan = latestSuccessfulScan(db, repository);
    expect(scan).toMatchObject({
      commitSha: github.head(repository),
      codeowners: { path: '.github/CODEOWNERS' },
    });
    expect(scan?.uploadedAt).not.toBeNull();
    const records = scanRecords(db, scan?.id ?? 0);
    expect(records.filter((record) => record.kind === 'reference')).toHaveLength(14);
    const [upload] = run.fake.state.codeReferenceScans;
    expect(upload).toMatchObject({
      repositoryUrl: `https://github.com/${repository}`,
      revision: scan?.commitSha,
    });
    expect(upload?.references).toContainEqual({
      feature_name: 'new_checkout',
      file_path: 'web/src/checkout/Checkout.tsx',
      line_number: 8,
    });
  });

  it('skips a rescan of the same commit with the same flag names', async () => {
    const before = latestSuccessfulScan(db, repository)?.id;

    await scanAfterSync();

    expect(latestSuccessfulScan(db, repository)?.id).toBe(before);
    expect(run.fake.state.codeReferenceScans).toHaveLength(1);
    expect(github.requests.filter((request) => request.path.includes('/tarball/'))).toHaveLength(1);
  });

  it('adds the mapped owner to every referenced flag, and changes nothing on a second run', async () => {
    replaceOwnerMappings(db, [
      { github: '@AvikSrivastava10', kind: 'user', flagsmithUserId: operator },
    ]);

    await scanAfterSync();

    expect(ownersOf('new_checkout')).toEqual([operator]);
    expect(ownersOf('order_tracking_v2')).toEqual([operator]);
    expect(ownersOf('legacy_search')).toEqual([]);
    expect(listAddedOwners(db)).toHaveLength(8);
    const writes = run.fake.writes().length;
    await scanAfterSync();
    expect(run.fake.writes()).toHaveLength(writes);
  });

  it('rescans a new commit, and removes only the owners FlagOps added once a flag loses its references', async () => {
    run.fake.state.owners.push({ feature: flagId('order_tracking_v2'), kind: 'user', id: 99 });
    const orders = demoFiles['api/src/routes/orders.ts'] ?? '';
    pushFiles({
      ...demoFiles,
      'api/src/routes/orders.ts': orders.replaceAll(
        "request.flags.isFeatureEnabled('order_tracking_v2')",
        'true',
      ),
    });

    await scanAfterSync();

    expect(latestSuccessfulScan(db, repository)?.commitSha).toBe(github.head(repository));
    expect(ownersOf('order_tracking_v2')).toEqual([99]);
    expect(ownersOf('new_checkout')).toEqual([operator]);
  });

  it('marks a failed Code References upload and sends it again on the next run, without a new download', async () => {
    pushFiles({ ...demoFiles, 'README.md': `${demoFiles['README.md'] ?? ''}\nOne more line.\n` });
    run.fake.failNext(/^\/api\/v1\/projects\/\d+\/code-references\/$/, 502, { detail: 'down' });

    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'flagsmith_server_error' });

    const failed = latestSuccessfulScan(db, repository);
    expect(failed).toMatchObject({
      commitSha: github.head(repository),
      uploadedAt: null,
      uploadErrorCode: 'flagsmith_server_error',
    });
    const downloads = github.requests.filter((request) => request.path.includes('/tarball/'));
    const uploads = run.fake.state.codeReferenceScans.length;

    await scanAfterSync();

    expect(latestSuccessfulScan(db, repository)).toMatchObject({
      id: failed?.id,
      uploadErrorCode: null,
    });
    expect(latestSuccessfulScan(db, repository)?.uploadedAt).not.toBeNull();
    expect(run.fake.state.codeReferenceScans).toHaveLength(uploads + 1);
    expect(github.requests.filter((request) => request.path.includes('/tarball/'))).toHaveLength(
      downloads.length,
    );
  });

  it('rescans the same commit when the set of flag names changes', async () => {
    const before = latestSuccessfulScan(db, repository);
    run.fake.state.features.push({
      ...run.fake.state.features[0]!,
      id: 999_999,
      name: 'brand_new_flag',
    });
    await sync.run();

    await scanAfterSync();

    const after = latestSuccessfulScan(db, repository);
    expect(after?.commitSha).toBe(before?.commitSha);
    expect(after?.flagNamesHash).not.toBe(before?.flagNamesHash);
  });

  it('repeats an owner change that failed with a server error on the next runs, without a new scan, and warns once', async () => {
    const scan = latestSuccessfulScan(db, repository)?.id;
    const downloads = tarballDownloads();
    const mark = logs.entries().length;
    removeOperatorFromNewCheckout();
    run.fake.failNext(/\/add-owners\/$/, 502, { detail: 'down' });
    run.fake.failNext(/\/add-owners\/$/, 502, { detail: 'down' });
    scans.scanNow(undefined);

    await expect(scans.run()).rejects.toMatchObject({ code: 'flagsmith_server_error' });
    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'flagsmith_server_error' });
    expect(ownersOf('new_checkout')).toEqual([]);

    await scanAfterSync();

    expect(ownersOf('new_checkout')).toEqual([operator]);
    expect(scans.status().ownerSync).toMatchObject({
      state: 'succeeded',
      report: { added: 1, removed: 0, failures: [] },
    });
    expect(messages(warn, mark)).toEqual([
      expect.stringMatching(/^Owner sync failed for new_checkout: Flagsmith failed with HTTP 502/),
    ]);
    expect(latestSuccessfulScan(db, repository)?.id).toBe(scan);
    expect(tarballDownloads()).toBe(downloads);
  });

  it('leaves an owner change that Flagsmith refused for the next trigger, such as "Scan now"', async () => {
    removeOperatorFromNewCheckout();
    run.fake.failNext(/\/add-owners\/$/, 400, { user_ids: ['Some users not found'] });
    scans.scanNow(undefined);

    await expect(scans.run()).rejects.toMatchObject({ code: 'flagsmith_validation' });
    const attempts = addOwnerRequests();
    await scanAfterSync();
    expect(addOwnerRequests()).toBe(attempts);
    expect(ownersOf('new_checkout')).toEqual([]);

    scans.scanNow(undefined);
    await scans.run();

    expect(ownersOf('new_checkout')).toEqual([operator]);
    expect(addOwnerRequests()).toBe(attempts + 1);
  });

  it('records a body that is not a tarball as a failed scan, keeps the reference set, and scans the commit once GitHub serves it', async () => {
    const reference = latestSuccessfulScan(db, repository)?.id;
    const mark = logs.entries().length;
    pushFiles({
      ...demoFiles,
      'README.md': `${demoFiles['README.md'] ?? ''}\nServed as HTML once.\n`,
    });
    github.failNext(
      { path: /\/tarball\// },
      {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<!doctype html><title>Sign in</title>',
      },
    );

    await expect(scanAfterSync()).rejects.toMatchObject({ code: 'github_server_error' });

    expect(latestScan(db, repository)).toMatchObject({
      outcome: 'failed',
      commitSha: github.head(repository),
      errorCode: 'github_server_error',
    });
    expect(latestSuccessfulScan(db, repository)?.id).toBe(reference);
    expect(messages(warn, mark)).toEqual([
      `Scan of ${repository} failed: GitHub answered GET /repos/${repository}/tarball/${github.head(repository) ?? ''} with a response FlagOps does not understand (a body that is not a readable gzipped tarball).`,
    ]);

    await scanAfterSync();

    expect(latestScan(db, repository)).toMatchObject({
      outcome: 'succeeded',
      commitSha: github.head(repository),
    });
    expect(scanOutcomes().failed).toBeUndefined();
    expect(messages(info, mark)).toContain(`Scanning ${repository} works again`);
  });

  it('keeps the reference set through 25 failed runs, records each failure, warns once, and ends the outage on the next run', async () => {
    const reference = latestSuccessfulScan(db, repository);
    const records = scanRecords(db, reference?.id ?? 0);
    const mark = logs.entries().length;

    // A revoked token: every run fails at its head check, the first request it makes.
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      github.failNext(
        { path: /\/git\/ref\/heads\// },
        { status: 401, body: { message: 'Bad credentials' } },
      );
      await expect(scanAfterSync()).rejects.toMatchObject({ code: 'github_bad_credentials' });
      expect(latestScan(db, repository)).toMatchObject({
        outcome: 'failed',
        errorCode: 'github_bad_credentials',
      });
    }

    expect(scanOutcomes()).toEqual({ failed: 20, succeeded: 1 });
    expect(scans.status().repositories[0]?.current?.id).toBe(reference?.id);
    expect(scanRecords(db, reference?.id ?? 0)).toEqual(records);
    expect(messages(warn, mark)).toEqual([
      `Scan of ${repository} failed: GitHub rejected GITHUB_TOKEN as bad credentials. Create a new token and update GITHUB_TOKEN.`,
    ]);

    await scanAfterSync();

    expect(scanOutcomes()).toEqual({ succeeded: 1 });
    expect(scans.status().repositories[0]?.latest?.id).toBe(reference?.id);
    expect(messages(info, mark)).toEqual([`Scanning ${repository} works again`]);
  });
});

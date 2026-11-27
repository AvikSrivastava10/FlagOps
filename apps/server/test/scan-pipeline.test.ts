import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDemoShopFiles } from '../src/cli/demo-publish.js';
import { Secret } from '../src/config/secret.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { listAddedOwners, replaceOwnerMappings } from '../src/db/repos/owners.js';
import { latestSuccessfulScan, scanRecords } from '../src/db/repos/scans.js';
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
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { insertScan } from '../db/repos/scans.js';
import { createLogger } from '../logger.js';
import { syncOwners, type OwnerSyncReport } from './sync.js';
import { createOwnerSyncer, type OwnerSyncer } from './syncer.js';

// When the owner syncer runs syncOwners (architecture.md 8.5). The sync itself is replaced, so a
// test can hold it in flight; the scan-pipeline test covers it against the fake Flagsmith.
vi.mock('./sync.js', () => ({ syncOwners: vi.fn() }));

const repository = 'AvikSrivastava10/flagops-demo-shop';
const flagNamesHash = 'hash of the current flag names';
const projectId = 1;
const noChanges: OwnerSyncReport = { added: 0, removed: 0, failures: [] };
let dataDir: string;
let db: Db;
let syncer: OwnerSyncer;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-syncer-'));
  db = openDatabase(dataDir);
  migrate(db);
  insertScan(
    db,
    {
      repository,
      commitSha: 'a'.repeat(40),
      flagNamesHash,
      startedAt: new Date(),
      finishedAt: new Date(),
      filesScanned: 0,
      filesSkipped: [],
      accessorProblems: [],
      codeowners: null,
    },
    [],
  );
  syncer = createOwnerSyncer({
    db,
    repositories: [repository],
    flagsmith: fakeClient().client,
    credential: organisationKey,
    logger: createLogger('info', captureLogs().destination),
    now: () => new Date(),
  });
  vi.mocked(syncOwners).mockReset();
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('createOwnerSyncer', () => {
  it('syncs owners on the first run, and not again until something makes a run due', async () => {
    vi.mocked(syncOwners).mockResolvedValue(noChanges);

    await syncer.syncIfDue(projectId, flagNamesHash, false);
    await syncer.syncIfDue(projectId, flagNamesHash, false);

    expect(syncOwners).toHaveBeenCalledTimes(1);
  });

  it('keeps a "Scan now" made while an owner sync runs, so the next run syncs owners again', async () => {
    let finish: (report: OwnerSyncReport) => void = () => undefined;
    vi.mocked(syncOwners)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(noChanges);

    const running = syncer.syncIfDue(projectId, flagNamesHash, false);
    syncer.request();
    finish(noChanges);
    await running;
    await syncer.syncIfDue(projectId, flagNamesHash, false);

    expect(syncOwners).toHaveBeenCalledTimes(2);
  });
});

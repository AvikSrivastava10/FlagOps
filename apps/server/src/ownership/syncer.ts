import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import type { Db } from '../db/connection.js';
import { listOwnerMappings } from '../db/repos/owners.js';
import { latestSuccessfulScan, scanRecords } from '../db/repos/scans.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import { deriveOwners } from './derive.js';
import { syncOwners, type OwnerSyncReport } from './sync.js';

/**
 * When the owner sync runs (architecture.md 8.5): after a scan job run that stored a new scan,
 * after "Scan now", once the owner mappings changed, and on the first run after FlagOps starts. A
 * sync that could not run through stays due. It waits until every tracked repository has a scan
 * with the current flag names, because a flag's owners come from all of them.
 */
export type OwnerSyncerOptions = {
  db: Db;
  repositories: readonly string[];
  flagsmith: FlagsmithClient;
  /** The organisation key: the owner sync is background work (D-008). */
  credential: FlagsmithCredential;
  logger: Logger;
  now: () => Date;
};

/** The latest owner sync since FlagOps started; the flag page shows its per-flag failures. */
export type OwnerSyncStatus =
  | { state: 'not_run' }
  | { state: 'succeeded'; at: string; report: OwnerSyncReport }
  | { state: 'failed'; at: string; code: string; message: string };

export type OwnerSyncer = {
  /** Makes the next run sync owners even when it stores no new scan. */
  request(): void;
  /** Syncs owners when due, and returns the failure of a sync that could not run through. */
  syncIfDue(
    projectId: number,
    flagNamesHash: string,
    scanned: boolean,
  ): Promise<FlagOpsError | undefined>;
  status(): OwnerSyncStatus;
};

export function createOwnerSyncer(options: OwnerSyncerOptions): OwnerSyncer {
  let due = true;
  let syncedMappings: string | undefined;
  let status: OwnerSyncStatus = { state: 'not_run' };

  return {
    request() {
      due = true;
    },
    async syncIfDue(projectId, flagNamesHash, scanned) {
      const mappings = JSON.stringify(listOwnerMappings(options.db));
      due ||= scanned || mappings !== syncedMappings;
      const scans = options.repositories.map((repository) =>
        latestSuccessfulScan(options.db, repository),
      );
      if (!due || scans.some((scan) => scan?.flagNamesHash !== flagNamesHash)) {
        return undefined;
      }
      const derived = deriveOwners(
        scans.flatMap((scan) =>
          scan === undefined
            ? []
            : [
                {
                  repository: scan.repository,
                  codeowners: scan.codeowners,
                  records: scanRecords(options.db, scan.id),
                },
              ],
        ),
      );
      try {
        const report = await syncOwners(
          {
            db: options.db,
            client: options.flagsmith,
            credential: options.credential,
            logger: options.logger,
          },
          projectId,
          derived,
        );
        status = { state: 'succeeded', at: options.now().toISOString(), report };
        due = false;
        syncedMappings = mappings;
        return undefined;
      } catch (error) {
        if (!(error instanceof FlagOpsError)) {
          throw error;
        }
        // Warn on the first failure of an outage only (architecture.md 18.2).
        if (status.state !== 'failed') {
          options.logger.warn({ code: error.code }, `Owner sync failed: ${error.message}`);
        }
        status = {
          state: 'failed',
          at: options.now().toISOString(),
          code: error.code,
          message: error.message,
        };
        return error;
      }
    },
    status: () => status,
  };
}

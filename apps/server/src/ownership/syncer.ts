import { FlagOpsError, type ErrorCode } from '@flagops/shared';
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
 * sync that could not run through stays due, and so does one with an owner change that failed in
 * a way the same request may not meet again (6.5, 18.2). It waits until every tracked repository
 * has a scan with the current flag names, because a flag's owners come from all of them.
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

/**
 * The latest owner sync since FlagOps started. `succeeded` means every flag had its turn, and the
 * report lists the owner changes that failed, which the flag page shows.
 */
export type OwnerSyncStatus =
  | { state: 'not_run' }
  | { state: 'succeeded'; at: string; report: OwnerSyncReport }
  | { state: 'failed'; at: string; code: string; message: string };

export type OwnerSyncer = {
  /** Makes the next run sync owners even when it stores no new scan. */
  request(): void;
  /**
   * Syncs owners when due, and returns the first failure: of a sync that could not run through,
   * or of an owner change, so the scan job's run fails as it does for a failed upload.
   */
  syncIfDue(
    projectId: number,
    flagNamesHash: string,
    scanned: boolean,
  ): Promise<FlagOpsError | undefined>;
  status(): OwnerSyncStatus;
};

/**
 * Failures the next run may not meet: the network, a server error and a rate limit. A change
 * Flagsmith refused waits for the next trigger, because the same request would be refused again.
 */
const repeatedByNextRun: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'flagsmith_unreachable',
  'flagsmith_server_error',
  'flagsmith_rate_limited',
]);

export function createOwnerSyncer(options: OwnerSyncerOptions): OwnerSyncer {
  let due = true;
  let syncedMappings: string | undefined;
  let status: OwnerSyncStatus = { state: 'not_run' };

  /** Warns on the first failure of each flag's outage only (architecture.md 18.2). */
  function warnNewFailures(report: OwnerSyncReport): void {
    const failingBefore = new Set(
      status.state === 'succeeded' ? status.report.failures.map((failure) => failure.flag) : [],
    );
    for (const failure of report.failures) {
      if (!failingBefore.has(failure.flag)) {
        options.logger.warn(
          { flag: failure.flag, code: failure.code },
          `Owner sync failed for ${failure.flag}: ${failure.message}`,
        );
      }
    }
  }

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
      // Cleared before the sync, so a "Scan now" made while it runs keeps the next run due.
      due = false;
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
        warnNewFailures(report);
        status = { state: 'succeeded', at: options.now().toISOString(), report };
        due ||= report.failures.some((failure) => repeatedByNextRun.has(failure.code));
        syncedMappings = mappings;
        const [failure] = report.failures;
        return failure === undefined
          ? undefined
          : new FlagOpsError(
              failure.code,
              `Owner sync failed for ${failure.flag}: ${failure.message}`,
            );
      } catch (error) {
        due = true;
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

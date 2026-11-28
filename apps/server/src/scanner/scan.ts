import { createHash } from 'node:crypto';
import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import type { Db } from '../db/connection.js';
import {
  clearFailedScans,
  insertFailedScan,
  insertScan,
  latestScan,
  latestSuccessfulScan,
  markUploadFailed,
  markUploaded,
  scanRecords,
  type ScanCodeowners,
  type StoredScan,
} from '../db/repos/scans.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import { uploadCodeReferences } from '../flagsmith/code-references.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import type { GitHubClient } from '../github/client.js';
import { unexpectedResponseError } from '../github/errors.js';
import { downloadTarball, getBranchHead, getDefaultBranch } from '../github/git-data.js';
import type { InventoryStore } from '../inventory/store.js';
import { matchRepository, type RepositoryFile } from '../matcher/match-repository.js';
import type { CodeRecord } from '../matcher/records.js';
import { createOwnerSyncer, type OwnerSyncStatus } from '../ownership/syncer.js';
import { readArchive, type ArchiveContents } from './archive.js';
import { codeownersLocations, parseCodeowners } from './codeowners.js';

/**
 * The scan job (architecture.md 8.5): each requested repository is scanned when its head commit or
 * the set of Flagsmith flag names changed since its last successful scan, and each new scan is
 * uploaded to Code References. The owner sync follows when it is due.
 */
export type ScanServiceOptions = {
  db: Db;
  github: GitHubClient;
  repositories: readonly string[];
  flagsmith: FlagsmithClient;
  /** The organisation key: scanning is background work (D-008). */
  credential: FlagsmithCredential;
  inventory: InventoryStore;
  logger: Logger;
  now?: () => Date;
};

export type RepositoryScanStatus = {
  repository: string;
  /** The newest scan, which may have failed: the status page shows its code (18.2). */
  latest: StoredScan | undefined;
  /** The newest successful scan: the reference set in use, with its skipped files (8.5). */
  current: StoredScan | undefined;
};

/** The status data for scans, which the status page and the flag page read. */
export type ScanStatus = { repositories: RepositoryScanStatus[]; ownerSync: OwnerSyncStatus };

export type ScanService = {
  /** After each sync: every tracked repository gets its head check on the next run. */
  requestAll(): void;
  /**
   * `POST /api/scans`: the named tracked repository, or all of them, with an owner sync after the
   * run even when no scan was needed. An untracked repository is refused.
   */
  scanNow(repository: string | undefined): void;
  /** Fails with the first failure of the run, after every repository had its turn. */
  run(): Promise<void>;
  status(): ScanStatus;
};

/** SHA-256 of the sorted flag names: scans depend on them (8.5). */
export function flagNamesHash(names: readonly string[]): string {
  return createHash('sha256')
    .update([...names].sort().join('\n'))
    .digest('hex');
}

function codeownersOf(files: readonly RepositoryFile[]): ScanCodeowners | null {
  for (const location of codeownersLocations) {
    const file = files.find((candidate) => candidate.path === location);
    if (file !== undefined) {
      return {
        path: file.path,
        text: file.text,
        errors: parseCodeowners(file.path, file.text).errors,
      };
    }
  }
  return null;
}

type ScanOutcome = { scanned: boolean; failure: FlagOpsError | undefined };

/** An exception FlagOps did not expect while scanning is a bug, kept as a failed scan (18.2). */
function unexpectedScanError(repository: string, cause: unknown): FlagOpsError {
  return new FlagOpsError(
    'internal_error',
    `Scanning ${repository} failed unexpectedly. The FlagOps log has the details.`,
    { cause },
  );
}

export function createScanService(options: ScanServiceOptions): ScanService {
  const now = options.now ?? (() => new Date());
  const pending = new Set<string>();
  const owners = createOwnerSyncer({
    db: options.db,
    repositories: options.repositories,
    flagsmith: options.flagsmith,
    credential: options.credential,
    logger: options.logger,
    now,
  });
  // The default branch is read once, so a run makes one ref check per repository (7.3).
  const defaultBranches = new Map<string, string>();

  async function defaultBranch(repository: string): Promise<string> {
    const known = defaultBranches.get(repository);
    if (known !== undefined) {
      return known;
    }
    const branch = await getDefaultBranch(options.github, repository);
    defaultBranches.set(repository, branch);
    return branch;
  }

  /** A body that is not a readable tarball is an answer FlagOps does not understand (18.2). */
  async function readTarball(repository: string, sha: string): Promise<ArchiveContents> {
    const tarball = await downloadTarball(options.github, repository, sha);
    try {
      return await readArchive(tarball);
    } catch {
      throw unexpectedResponseError(
        `GET /repos/${repository}/tarball/${sha}`,
        'a body that is not a readable gzipped tarball',
      );
    }
  }

  /** A run that reached the repository ends its outage, whose failed scans go (16). */
  function recovered(repository: string): void {
    if (clearFailedScans(options.db, repository) > 0) {
      options.logger.info({ repository }, `Scanning ${repository} works again`);
    }
  }

  /** A failed upload marks the scan "uploaded: no"; the next run retries it (18.2). */
  async function upload(
    repository: string,
    scanId: number,
    revision: string,
    records: readonly CodeRecord[],
    projectId: number,
  ): Promise<FlagOpsError | undefined> {
    try {
      await uploadCodeReferences(options.flagsmith, options.credential, projectId, {
        repositoryUrl: `https://github.com/${repository}`,
        revision,
        references: records.flatMap((record) =>
          record.kind === 'reference' && record.flagName !== null
            ? [{ featureName: record.flagName, filePath: record.filePath, lineNumber: record.line }]
            : [],
        ),
      });
      markUploaded(options.db, scanId, now());
      return undefined;
    } catch (error) {
      if (!(error instanceof FlagOpsError)) {
        throw error;
      }
      markUploadFailed(options.db, scanId, error.code);
      options.logger.warn(
        { repository, code: error.code },
        `Code References upload for ${repository} failed: ${error.message}`,
      );
      return error;
    }
  }

  async function scan(
    repository: string,
    flagNames: readonly string[],
    projectId: number,
  ): Promise<ScanOutcome> {
    const startedAt = now();
    const hash = flagNamesHash(flagNames);
    let commitSha: string | null = null;
    try {
      commitSha = await getBranchHead(options.github, repository, await defaultBranch(repository));
      if (commitSha === null) {
        throw new FlagOpsError(
          'github_conflict',
          `${repository} has no commits yet, so there is nothing to scan.`,
        );
      }
      const previous = latestSuccessfulScan(options.db, repository);
      if (previous?.commitSha === commitSha && previous.flagNamesHash === hash) {
        recovered(repository);
        const failure =
          previous.uploadedAt === null
            ? await upload(
                repository,
                previous.id,
                commitSha,
                scanRecords(options.db, previous.id),
                projectId,
              )
            : undefined;
        return { scanned: false, failure };
      }
      const contents = await readTarball(repository, commitSha);
      const result = matchRepository(contents.files, flagNames);
      const scanId = insertScan(
        options.db,
        {
          repository,
          commitSha,
          flagNamesHash: hash,
          startedAt,
          finishedAt: now(),
          filesScanned: result.filesMatched,
          filesSkipped: [
            ...contents.skipped,
            ...result.parseErrors.map((error) => ({
              path: error.path,
              reason: `does not parse: ${error.message}`,
            })),
          ],
          accessorProblems: result.accessorProblems,
          codeowners: codeownersOf(contents.files),
        },
        result.records,
      );
      recovered(repository);
      const references = result.records.filter((record) => record.kind === 'reference').length;
      options.logger.info(
        { repository, commit: commitSha, references },
        `Scanned ${repository} at ${commitSha.slice(0, 7)}`,
      );
      const failure = await upload(repository, scanId, commitSha, result.records, projectId);
      return { scanned: true, failure };
    } catch (caught) {
      // Any failure is this repository's failed scan, and the run goes on with the next one.
      const error =
        caught instanceof FlagOpsError ? caught : unexpectedScanError(repository, caught);
      // A renamed default branch is read again on the next run.
      if (error.code === 'github_not_found') {
        defaultBranches.delete(repository);
      }
      // A bug is logged with its stack once, even in the middle of an outage, and any other
      // failure on the first failed scan of an outage only (architecture.md 18.2, D-094).
      const latest = latestScan(options.db, repository);
      if (error.code === 'internal_error') {
        if (latest?.errorCode !== 'internal_error') {
          options.logger.error({ err: caught, repository }, `Scan of ${repository} failed`);
        }
      } else if (latest?.outcome !== 'failed') {
        options.logger.warn(
          { repository, code: error.code },
          `Scan of ${repository} failed: ${error.message}`,
        );
      }
      insertFailedScan(options.db, {
        repository,
        commitSha,
        flagNamesHash: hash,
        startedAt,
        finishedAt: now(),
        errorCode: error.code,
        errorMessage: error.message,
      });
      return { scanned: false, failure: error };
    }
  }

  function requestAll(): void {
    for (const repository of options.repositories) {
      pending.add(repository);
    }
  }

  return {
    requestAll,
    scanNow(repository) {
      if (repository === undefined) {
        requestAll();
      } else {
        const tracked = options.repositories.find(
          (name) => name.toLowerCase() === repository.toLowerCase(),
        );
        if (tracked === undefined) {
          throw new FlagOpsError(
            'github_repo_not_allowed',
            `${repository} is not one of the repositories in GITHUB_REPOSITORIES.`,
          );
        }
        pending.add(tracked);
      }
      owners.request();
    },
    async run() {
      const inventory = options.inventory.current();
      // Without a sync there are no flag names yet; the first sync triggers the run again.
      if (inventory === undefined) {
        return;
      }
      const requested = options.repositories.filter((repository) => pending.has(repository));
      pending.clear();
      const flagNames = inventory.flags.map((flag) => flag.name);
      const failures: FlagOpsError[] = [];
      let scanned = false;
      for (const repository of requested) {
        const outcome = await scan(repository, flagNames, inventory.project.id);
        scanned ||= outcome.scanned;
        if (outcome.failure !== undefined) {
          failures.push(outcome.failure);
        }
      }
      const ownerFailure = await owners.syncIfDue(
        inventory.project.id,
        flagNamesHash(flagNames),
        scanned,
      );
      const [first] = ownerFailure === undefined ? failures : [...failures, ownerFailure];
      if (first !== undefined) {
        throw first;
      }
    },
    status: () => ({
      repositories: options.repositories.map((repository) => ({
        repository,
        latest: latestScan(options.db, repository),
        current: latestSuccessfulScan(options.db, repository),
      })),
      ownerSync: owners.status(),
    }),
  };
}

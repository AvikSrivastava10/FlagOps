import type { RecordKind } from '@flagops/shared';
import type { AccessorProblem } from '../../matcher/accessor-config.js';
import type { CodeRecord } from '../../matcher/records.js';
import type { Product } from '../../matcher/sdk-modules.js';
import type { Db } from '../connection.js';

/** Scans and their records (architecture.md 8.5, 16). Older scans are dropped beyond 20. */
const keptScansPerRepository = 20;

export type SkippedFile = { path: string; reason: string };

export type CodeownersProblem = { line: number; text: string; reason: string };

export type ScanCodeowners = { path: string; text: string; errors: CodeownersProblem[] };

export type NewScan = {
  repository: string;
  commitSha: string;
  flagNamesHash: string;
  startedAt: Date;
  finishedAt: Date;
  filesScanned: number;
  filesSkipped: SkippedFile[];
  accessorProblems: AccessorProblem[];
  codeowners: ScanCodeowners | null;
};

export type FailedScan = {
  repository: string;
  commitSha: string | null;
  flagNamesHash: string;
  startedAt: Date;
  finishedAt: Date;
  errorCode: string;
  errorMessage: string;
};

export type StoredScan = Omit<NewScan, 'commitSha' | 'startedAt' | 'finishedAt'> & {
  id: number;
  commitSha: string | null;
  startedAt: string;
  finishedAt: string;
  outcome: 'succeeded' | 'failed';
  uploadedAt: string | null;
  uploadErrorCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type ScanRow = {
  id: number;
  repository: string;
  commit_sha: string | null;
  flag_names_hash: string;
  started_at: string;
  finished_at: string;
  outcome: 'succeeded' | 'failed';
  files_scanned: number;
  files_skipped_json: string;
  accessor_problems_json: string;
  codeowners_path: string | null;
  codeowners_text: string | null;
  codeowners_errors_json: string;
  uploaded_at: string | null;
  upload_error_code: string | null;
  error_code: string | null;
  error_message: string | null;
};

function fromRow(row: ScanRow): StoredScan {
  return {
    id: row.id,
    repository: row.repository,
    commitSha: row.commit_sha,
    flagNamesHash: row.flag_names_hash,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
    filesScanned: row.files_scanned,
    filesSkipped: JSON.parse(row.files_skipped_json) as SkippedFile[],
    accessorProblems: JSON.parse(row.accessor_problems_json) as AccessorProblem[],
    codeowners:
      row.codeowners_path === null
        ? null
        : {
            path: row.codeowners_path,
            text: row.codeowners_text ?? '',
            errors: JSON.parse(row.codeowners_errors_json) as CodeownersProblem[],
          },
    uploadedAt: row.uploaded_at,
    uploadErrorCode: row.upload_error_code,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function prune(db: Db, repository: string): void {
  db.prepare(
    `DELETE FROM scans WHERE repository = ? AND id NOT IN
       (SELECT id FROM scans WHERE repository = ? ORDER BY id DESC LIMIT ?)`,
  ).run(repository, repository, keptScansPerRepository);
}

/** Stores a successful scan and its records in one transaction, and returns its ID. */
export function insertScan(db: Db, scan: NewScan, records: readonly CodeRecord[]): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO scans (repository, commit_sha, flag_names_hash, started_at, finished_at, outcome,
           files_scanned, files_skipped_json, accessor_problems_json, codeowners_path,
           codeowners_text, codeowners_errors_json)
         VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scan.repository,
        scan.commitSha,
        scan.flagNamesHash,
        scan.startedAt.toISOString(),
        scan.finishedAt.toISOString(),
        scan.filesScanned,
        JSON.stringify(scan.filesSkipped),
        JSON.stringify(scan.accessorProblems),
        scan.codeowners?.path ?? null,
        scan.codeowners?.text ?? null,
        JSON.stringify(scan.codeowners?.errors ?? []),
      );
    const scanId = Number(lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO code_refs (scan_id, kind, flag_name, literal, product, rule_id, method, file_path,
         line, column, traced, evidence, snippet, suggestion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const record of records) {
      insert.run(
        scanId,
        record.kind,
        record.flagName,
        record.literal,
        record.product,
        record.ruleId,
        record.method,
        record.filePath,
        record.line,
        record.column,
        record.traced ? 1 : 0,
        record.evidence,
        record.snippet,
        record.suggestion,
      );
    }
    prune(db, scan.repository);
    return scanId;
  })();
}

export function insertFailedScan(db: Db, scan: FailedScan): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO scans (repository, commit_sha, flag_names_hash, started_at, finished_at, outcome,
           error_code, error_message)
         VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`,
      )
      .run(
        scan.repository,
        scan.commitSha,
        scan.flagNamesHash,
        scan.startedAt.toISOString(),
        scan.finishedAt.toISOString(),
        scan.errorCode,
        scan.errorMessage,
      );
    prune(db, scan.repository);
    return Number(lastInsertRowid);
  })();
}

/** The newest scan of a repository, successful or not. */
export function latestScan(db: Db, repository: string): StoredScan | undefined {
  const row = db
    .prepare<[string], ScanRow>('SELECT * FROM scans WHERE repository = ? ORDER BY id DESC LIMIT 1')
    .get(repository);
  return row === undefined ? undefined : fromRow(row);
}

/** The reference set of a repository: its newest successful scan (8.5). */
export function latestSuccessfulScan(db: Db, repository: string): StoredScan | undefined {
  const row = db
    .prepare<[string], ScanRow>(
      "SELECT * FROM scans WHERE repository = ? AND outcome = 'succeeded' ORDER BY id DESC LIMIT 1",
    )
    .get(repository);
  return row === undefined ? undefined : fromRow(row);
}

type RecordRow = {
  kind: RecordKind;
  flag_name: string | null;
  literal: string | null;
  product: Product | null;
  rule_id: string;
  method: string | null;
  file_path: string;
  line: number;
  column: number;
  traced: number;
  evidence: string;
  snippet: string;
  suggestion: string | null;
};

/** A scan's records, in the order the matcher produced them. */
export function scanRecords(db: Db, scanId: number): CodeRecord[] {
  return db
    .prepare<[number], RecordRow>('SELECT * FROM code_refs WHERE scan_id = ? ORDER BY rowid')
    .all(scanId)
    .map((row) => ({
      kind: row.kind,
      flagName: row.flag_name,
      literal: row.literal,
      product: row.product,
      ruleId: row.rule_id,
      method: row.method,
      filePath: row.file_path,
      line: row.line,
      column: row.column,
      traced: row.traced === 1,
      evidence: row.evidence,
      snippet: row.snippet,
      suggestion: row.suggestion,
    }));
}

export function markUploaded(db: Db, scanId: number, at: Date): void {
  db.prepare('UPDATE scans SET uploaded_at = ?, upload_error_code = NULL WHERE id = ?').run(
    at.toISOString(),
    scanId,
  );
}

export function markUploadFailed(db: Db, scanId: number, errorCode: string): void {
  db.prepare('UPDATE scans SET upload_error_code = ? WHERE id = ?').run(errorCode, scanId);
}

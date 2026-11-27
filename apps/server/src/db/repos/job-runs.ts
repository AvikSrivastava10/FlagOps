import type { Db } from '../connection.js';

/** Runs kept per job (architecture.md 16). */
const keptRunsPerJob = 200;

export type JobRun = {
  job: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: 'succeeded' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

/** Records a finished run, and drops the job's runs beyond the newest 200. */
export function recordJobRun(db: Db, run: JobRun): void {
  db.transaction(() => {
    db.prepare(
      'INSERT INTO job_runs (job, started_at, finished_at, outcome, error_code, error_message) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      run.job,
      run.startedAt.toISOString(),
      run.finishedAt.toISOString(),
      run.outcome,
      run.errorCode ?? null,
      run.errorMessage ?? null,
    );
    db.prepare(
      'DELETE FROM job_runs WHERE job = ? AND id NOT IN (SELECT id FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?)',
    ).run(run.job, run.job, keptRunsPerJob);
  })();
}

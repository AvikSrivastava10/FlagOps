import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../logger.js';
import { createScheduler, type Scheduler } from './scheduler.js';

let dataDir: string;
let db: Db;
let scheduler: Scheduler | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-jobs-'));
  db = openDatabase(dataDir);
  migrate(db);
});

afterEach(async () => {
  await scheduler?.stop();
  scheduler = undefined;
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A job whose runs wait until the test releases them. */
function gatedJob() {
  const releases: (() => void)[] = [];
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    release() {
      releases.shift()?.();
    },
    definition: {
      name: 'sync',
      intervalMs: 60_000,
      run: () => {
        runs += 1;
        return new Promise<void>((resolve) => releases.push(resolve));
      },
    },
  };
}

function runsRecorded(): { job: string; outcome: string; error_code: string | null }[] {
  return db
    .prepare<[], { job: string; outcome: string; error_code: string | null }>(
      'SELECT job, outcome, error_code FROM job_runs ORDER BY id',
    )
    .all();
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('createScheduler', () => {
  it('never overlaps a job with itself: triggers during a run queue one more run', async () => {
    const job = gatedJob();
    scheduler = createScheduler({ db, logger: createLogger('error'), jobs: [job.definition] });

    scheduler.start();
    expect(scheduler.trigger('sync')).toBe('queued');
    expect(scheduler.trigger('sync')).toBe('queued');
    expect(job.runs).toBe(1);

    job.release();
    await settle();
    expect(job.runs).toBe(2);
    job.release();
    await settle();
    expect(job.runs).toBe(2);
    expect(scheduler.trigger('sync')).toBe('started');
    expect(job.runs).toBe(3);
    job.release();
    await settle();
  });

  it('records every run in job_runs, with the code of a failure', async () => {
    const logs = captureLogs();
    let outcome: Error | undefined;
    scheduler = createScheduler({
      db,
      logger: createLogger('error', logs.destination),
      jobs: [
        {
          name: 'sync',
          intervalMs: 60_000,
          run: () => (outcome === undefined ? Promise.resolve() : Promise.reject(outcome)),
        },
      ],
    });

    scheduler.start();
    await settle();
    outcome = new FlagOpsError('flagsmith_unreachable', 'Flagsmith is down');
    scheduler.trigger('sync');
    await settle();
    outcome = new Error('a bug');
    scheduler.trigger('sync');
    await settle();

    expect(runsRecorded()).toEqual([
      { job: 'sync', outcome: 'succeeded', error_code: null },
      { job: 'sync', outcome: 'failed', error_code: 'flagsmith_unreachable' },
      { job: 'sync', outcome: 'failed', error_code: 'internal_error' },
    ]);
    // An expected failure is the job's to log; only the bug is logged here, with its stack.
    expect(logs.entries()).toEqual([
      expect.objectContaining({
        level: 50,
        job: 'sync',
        err: expect.objectContaining({ message: 'a bug' }) as unknown,
      }),
    ]);
  });

  it('runs a job again after its interval', async () => {
    let runs = 0;
    scheduler = createScheduler({
      db,
      logger: createLogger('error'),
      jobs: [{ name: 'sync', intervalMs: 5, run: async () => void (runs += 1) }],
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runs).toBeGreaterThan(2);
  });

  it('stops the timers and waits for a running job', async () => {
    const job = gatedJob();
    scheduler = createScheduler({ db, logger: createLogger('error'), jobs: [job.definition] });
    scheduler.start();

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    job.release();
    await stopping;

    expect(stopped).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(job.runs).toBe(1);
  });
});

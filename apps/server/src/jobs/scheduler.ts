import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import type { Db } from '../db/connection.js';
import { recordJobRun } from '../db/repos/job-runs.js';

export type JobDefinition = {
  name: string;
  /** The pause between the end of one run and the start of the next. */
  intervalMs: number;
  run(): Promise<void>;
};

export type Scheduler = {
  /** Runs every job once now, then at its interval. */
  start(): void;
  /** Runs the job now, or, when it is running, once more as soon as it finishes. */
  trigger(name: string): 'started' | 'queued';
  /** Stops the timers and waits up to 10 seconds for running jobs (architecture.md 17). */
  stop(): Promise<void>;
};

export type SchedulerOptions = {
  db: Db;
  logger: Logger;
  jobs: readonly JobDefinition[];
  now?: () => Date;
  shutdownTimeoutMs?: number;
};

type JobState = {
  definition: JobDefinition;
  running: Promise<void> | undefined;
  runAgain: boolean;
  timer: NodeJS.Timeout | undefined;
};

/**
 * Runs background jobs in the server process. A job never overlaps itself: a trigger during a run
 * queues one more run instead. Every run is recorded in `job_runs`, and a failed run is retried at
 * the next interval. Jobs log their own expected failures, so the scheduler logs only unexpected
 * ones, with the stack.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const now = options.now ?? (() => new Date());
  const states = new Map<string, JobState>(
    options.jobs.map((definition) => [
      definition.name,
      { definition, running: undefined, runAgain: false, timer: undefined },
    ]),
  );
  let stopped = false;

  async function execute(definition: JobDefinition): Promise<void> {
    const startedAt = now();
    let failure: unknown;
    try {
      await definition.run();
    } catch (error) {
      failure = error;
      if (!(error instanceof FlagOpsError)) {
        options.logger.error(
          { err: error, job: definition.name },
          `The ${definition.name} job failed unexpectedly`,
        );
      }
    }
    try {
      recordJobRun(options.db, {
        job: definition.name,
        startedAt,
        finishedAt: now(),
        ...(failure === undefined
          ? { outcome: 'succeeded' }
          : {
              outcome: 'failed',
              errorCode: failure instanceof FlagOpsError ? failure.code : 'internal_error',
              errorMessage:
                failure instanceof Error
                  ? failure.message
                  : 'The job failed with a non-Error value',
            }),
      });
    } catch (error) {
      options.logger.error({ err: error, job: definition.name }, 'Recording a job run failed');
    }
  }

  function runNow(state: JobState): void {
    if (stopped) {
      return;
    }
    clearTimeout(state.timer);
    state.running = execute(state.definition).finally(() => {
      state.running = undefined;
      if (stopped) {
        return;
      }
      if (state.runAgain) {
        state.runAgain = false;
        runNow(state);
        return;
      }
      state.timer = setTimeout(() => {
        runNow(state);
      }, state.definition.intervalMs);
      state.timer.unref();
    });
  }

  function stateOf(name: string): JobState {
    const state = states.get(name);
    if (state === undefined) {
      throw new Error(`No job named ${name}`);
    }
    return state;
  }

  return {
    start() {
      for (const state of states.values()) {
        runNow(state);
      }
    },
    trigger(name) {
      const state = stateOf(name);
      if (state.running !== undefined) {
        state.runAgain = true;
        return 'queued';
      }
      runNow(state);
      return 'started';
    },
    async stop() {
      stopped = true;
      const running: Promise<void>[] = [];
      for (const state of states.values()) {
        clearTimeout(state.timer);
        if (state.running !== undefined) {
          running.push(state.running);
        }
      }
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(running),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, options.shutdownTimeoutMs ?? 10_000);
        }),
      ]);
      clearTimeout(timeout);
    },
  };
}

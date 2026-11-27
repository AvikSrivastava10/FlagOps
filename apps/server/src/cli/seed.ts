import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import { appendAudit } from '../audit/audit.js';
import { ConfigError, loadConfig, type Config } from '../config/load.js';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { readSetting, writeSetting } from '../db/repos/settings.js';
import { createFlagsmithClient } from '../flagsmith/client.js';
import { createLogger } from '../logger.js';
import { runSeed, type SeedReport } from './seed-runner.js';

function reportFailure(logger: Logger, error: unknown): void {
  if (error instanceof ConfigError) {
    for (const problem of error.problems) {
      logger.error(problem);
    }
  } else if (error instanceof FlagOpsError) {
    logger.error({ code: error.code }, error.message);
  } else {
    logger.error({ err: error }, 'The seed failed with an unexpected error');
  }
  process.exitCode = 1;
}

/** Records the seed's writes in FlagOps' audit log; a run that wrote nothing leaves no entry. */
function auditSeed(db: Db, report: SeedReport, error: unknown): void {
  if (report.changes.length === 0 && error === undefined) {
    return;
  }
  appendAudit(db, {
    actor: { kind: 'system' },
    action: 'seed',
    outcome: error === undefined ? 'succeeded' : 'failed',
    details: { changes: report.changes, warnings: report.warnings },
    ...(error instanceof Error ? { errorMessage: error.message } : {}),
  });
}

/**
 * `pnpm seed` (or `docker compose run --rm flagops seed`): seeds the demo project in the
 * organisation of FLAGSMITH_ORG_API_KEY. It records FlagOps' type tags in the data directory, so
 * the server and the seed agree on which tags are FlagOps' own.
 */
async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    reportFailure(createLogger('info'), error);
    return;
  }
  const logger = createLogger(config.logLevel);
  let db: Db | undefined;
  try {
    db = openDatabase(config.dataDir);
    migrate(db);
  } catch (error) {
    reportFailure(logger, error);
    db?.close();
    return;
  }
  const settings = db;
  const report: SeedReport = { changes: [], warnings: [] };
  let failure: unknown;
  try {
    await runSeed(
      {
        client: createFlagsmithClient({ baseUrl: config.flagsmith.requestUrl, logger }),
        credential: { kind: 'organisation_key', key: config.flagsmith.orgApiKey },
        typeTagIds: {
          load: () => readSetting(settings, 'type_tag_ids') ?? {},
          save: (ids) => {
            writeSetting(settings, 'type_tag_ids', ids);
          },
        },
        logger,
      },
      report,
    );
  } catch (error) {
    failure = error;
    reportFailure(logger, error);
  } finally {
    auditSeed(settings, report, failure);
    settings.close();
  }
}

await main();

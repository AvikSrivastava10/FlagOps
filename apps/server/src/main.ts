import type { Logger } from 'pino';
import { ConfigError, loadConfig, type Config } from './config/load.js';
import { createLogger } from './logger.js';
import { start, type RunningServer } from './start.js';

/** Startup problems go to the same JSON log as everything else, and the process exits with 1. */
function failStartup(logger: Logger, error: unknown): void {
  if (error instanceof ConfigError) {
    for (const problem of error.problems) {
      logger.error(problem);
    }
  } else {
    logger.error({ err: error }, 'FlagOps failed to start');
  }
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    failStartup(createLogger('info'), error);
    return;
  }

  const logger = createLogger(config.logLevel);
  let server: RunningServer;
  try {
    server = await start(config, logger);
  } catch (error) {
    failStartup(logger, error);
    return;
  }

  const stop = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Shutting down');
    server.close().catch((error: unknown) => {
      logger.error({ err: error }, 'Shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

await main();

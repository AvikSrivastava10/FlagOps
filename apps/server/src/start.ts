import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import { createAttemptLimiter } from './auth/attempt-limiter.js';
import { createAuthService } from './auth/login.js';
import { createMfaChallenges } from './auth/mfa.js';
import { createMemorySessionStore } from './auth/sessions.js';
import type { Config } from './config/load.js';
import { openDatabase, type Db } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createFlagsmithClient, type FlagsmithClient } from './flagsmith/client.js';
import type { FlagsmithCredential } from './flagsmith/credentials.js';
import { keyOrganisationResolver } from './flagsmith/projects.js';
import { createGitHubClient } from './github/client.js';
import { buildApp, type App } from './http/app.js';
import { createInventoryStore, type InventoryStore } from './inventory/store.js';
import { createInventorySync } from './inventory/sync.js';
import { scanJob, syncJob } from './jobs/definitions.js';
import { createScheduler } from './jobs/scheduler.js';
import { readDirectory, saveOwnerMappings } from './ownership/mappings.js';
import { createScanService, type ScanService } from './scanner/scan.js';

/** `pnpm build` copies the built web app here, next to the compiled server. */
const webRoot = fileURLToPath(new URL('./public/', import.meta.url));

export type RunningServer = {
  app: App;
  close(): Promise<void>;
};

export type StartOptions = {
  /** How FlagOps reaches Flagsmith; tests pass a fake. */
  fetch?: (request: Request) => Promise<Response>;
  /** The GitHub API base URL; only tests pass one, for the fake GitHub (architecture.md 7.2). */
  githubBaseUrl?: string;
};

type ScanDeps = {
  db: Db;
  client: FlagsmithClient;
  organisationKey: FlagsmithCredential;
  inventory: InventoryStore;
  logger: Logger;
  githubBaseUrl?: string;
};

/** The scan service, or undefined when GitHub is not configured (architecture.md 21). */
function createScans(config: Config, deps: ScanDeps): ScanService | undefined {
  const { token, repositories, problem } = config.github;
  if (token === undefined) {
    deps.logger.info(`Scanning and Retire are off: ${problem ?? 'GitHub is not configured'}.`);
    return undefined;
  }
  return createScanService({
    db: deps.db,
    github: createGitHubClient({
      token,
      repositories,
      logger: deps.logger,
      ...(deps.githubBaseUrl === undefined ? {} : { baseUrl: deps.githubBaseUrl }),
    }),
    repositories,
    flagsmith: deps.client,
    credential: deps.organisationKey,
    inventory: deps.inventory,
    logger: deps.logger,
  });
}

/** `POST /api/scans` while GitHub is not configured. */
function scanningOff(config: Config): FlagOpsError {
  return new FlagOpsError(
    'github_not_configured',
    `Scanning is off: ${config.github.problem ?? 'GitHub is not configured'}.`,
  );
}

/** Opens the database, applies migrations, starts listening, then starts the background jobs. */
export async function start(
  config: Config,
  logger: Logger,
  options: StartOptions = {},
): Promise<RunningServer> {
  if (config.flagsmith.rewrittenForDocker) {
    logger.info(
      { flagsmithUrl: config.flagsmith.dashboardUrl, requestUrl: config.flagsmith.requestUrl },
      'Inside the container, localhost is the container itself, so FlagOps sends its Flagsmith requests to host.docker.internal. Dashboard links keep FLAGSMITH_URL.',
    );
  }

  const db = openDatabase(config.dataDir);
  let app: App | undefined;
  try {
    for (const migration of migrate(db)) {
      logger.info({ migration }, 'Applied database migration');
    }
    const hasWebApp = existsSync(path.join(webRoot, 'index.html'));
    if (!hasWebApp) {
      logger.warn(
        { webRoot },
        'No built web app, so only the API is served: pnpm build adds it, and pnpm dev serves it through Vite.',
      );
    }
    const client = createFlagsmithClient({
      baseUrl: config.flagsmith.requestUrl,
      logger,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    const organisationKey: FlagsmithCredential = {
      kind: 'organisation_key',
      key: config.flagsmith.orgApiKey,
    };
    const keyOrganisation = keyOrganisationResolver(client, organisationKey);
    const inventory = createInventoryStore();
    const sync = createInventorySync({
      client,
      credential: organisationKey,
      keyOrganisation,
      projectId: config.flagsmith.projectId,
      store: inventory,
      logger,
    });
    const scans = createScans(config, {
      db,
      client,
      organisationKey,
      inventory,
      logger,
      ...(options.githubBaseUrl === undefined ? {} : { githubBaseUrl: options.githubBaseUrl }),
    });
    const scheduler = createScheduler({
      db,
      logger,
      jobs: [
        syncJob(sync, config.jobs.syncIntervalSeconds, () => {
          if (scans !== undefined) {
            scans.requestAll();
            scheduler.trigger('scan');
          }
        }),
        ...(scans === undefined ? [] : [scanJob(scans)]),
      ],
    });
    const ownerDeps = { db, client, credential: organisationKey, keyOrganisation };
    const sessions = createMemorySessionStore();
    app = await buildApp({
      logger,
      allowedHosts: config.http.allowedHosts,
      trustProxy: config.http.trustProxy,
      webRoot: hasWebApp ? webRoot : undefined,
      sessions,
      auth: createAuthService({
        client,
        keyOrganisation,
        sessions,
        challenges: createMfaChallenges(),
        limiter: createAttemptLimiter(),
        db,
        logger,
      }),
      triggerSync: () => scheduler.trigger('sync'),
      triggerScan: (repository) => {
        if (scans === undefined) {
          throw scanningOff(config);
        }
        scans.scanNow(repository);
        return scheduler.trigger('scan');
      },
      ownerMappings: {
        directory: () => readDirectory(ownerDeps),
        save: (mappings, actor) => saveOwnerMappings(ownerDeps, mappings, actor),
      },
    });
    await app.listen({ port: config.http.port, host: config.http.bind });
    scheduler.start();

    const running = app;
    return {
      app: running,
      async close() {
        await running.close();
        await scheduler.stop();
        db.close();
      },
    };
  } catch (error) {
    await app?.close();
    db.close();
    throw error;
  }
}

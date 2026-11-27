import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import { createAttemptLimiter } from './auth/attempt-limiter.js';
import { createAuthService } from './auth/login.js';
import { createMfaChallenges } from './auth/mfa.js';
import { createMemorySessionStore } from './auth/sessions.js';
import type { Config } from './config/load.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createFlagsmithClient } from './flagsmith/client.js';
import type { FlagsmithCredential } from './flagsmith/credentials.js';
import { keyOrganisationResolver } from './flagsmith/projects.js';
import { buildApp, type App } from './http/app.js';
import { createInventoryStore } from './inventory/store.js';
import { createInventorySync } from './inventory/sync.js';
import { syncJob } from './jobs/definitions.js';
import { createScheduler } from './jobs/scheduler.js';

/** `pnpm build` copies the built web app here, next to the compiled server. */
const webRoot = fileURLToPath(new URL('./public/', import.meta.url));

export type RunningServer = {
  app: App;
  close(): Promise<void>;
};

export type StartOptions = {
  /** How FlagOps reaches Flagsmith; tests pass a fake. */
  fetch?: (request: Request) => Promise<Response>;
};

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
    const sync = createInventorySync({
      client,
      credential: organisationKey,
      keyOrganisation,
      projectId: config.flagsmith.projectId,
      store: createInventoryStore(),
      logger,
    });
    const scheduler = createScheduler({
      db,
      logger,
      jobs: [syncJob(sync, config.jobs.syncIntervalSeconds)],
    });
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

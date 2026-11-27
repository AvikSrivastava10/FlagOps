import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { Config } from './config/load.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { buildApp, type App } from './http/app.js';

/** `pnpm build` copies the built web app here, next to the compiled server. */
const webRoot = fileURLToPath(new URL('./public/', import.meta.url));

export type RunningServer = {
  app: App;
  close(): Promise<void>;
};

/** Opens the database, applies migrations, and starts listening. */
export async function start(config: Config, logger: Logger): Promise<RunningServer> {
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
    app = await buildApp({
      logger,
      allowedHosts: config.http.allowedHosts,
      trustProxy: config.http.trustProxy,
      webRoot: hasWebApp ? webRoot : undefined,
    });
    await app.listen({ port: config.http.port, host: config.http.bind });
  } catch (error) {
    await app?.close();
    db.close();
    throw error;
  }

  const running = app;
  return {
    app: running,
    async close() {
      await running.close();
      db.close();
    },
  };
}

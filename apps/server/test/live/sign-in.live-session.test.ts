import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAttemptLimiter } from '../../src/auth/attempt-limiter.js';
import { createAuthService } from '../../src/auth/login.js';
import { createMfaChallenges } from '../../src/auth/mfa.js';
import { createMemorySessionStore } from '../../src/auth/sessions.js';
import { openDatabase, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { keyOrganisationResolver } from '../../src/flagsmith/projects.js';
import type { App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildTestApp, writeHeaders } from '../helpers/app.js';
import { captureLogs } from '../helpers/log-capture.js';
import { liveClient, liveOrganisationKey, skipReason } from '../helpers/live.js';

/**
 * A real sign-in through FlagOps' routes with the operator's Flagsmith account (plan S3.6
 * [session]), run only by `pnpm test:live-session`. It makes exactly one sign-in attempt:
 * Flagsmith locks an account after 10 refused sign-ins within 15 minutes of each other
 * (`AXES_FAILURE_LIMIT`, `AXES_COOLOFF_TIME`), so a wrong E2E password must never be retried by
 * every live run (D-079). The email and password come from `.env` and are never printed.
 */
const skip = skipReason(
  'FLAGSMITH_URL',
  'FLAGSMITH_ORG_API_KEY',
  'E2E_FLAGSMITH_EMAIL',
  'E2E_FLAGSMITH_PASSWORD',
);

describe.skipIf(skip !== undefined)(
  `sign-in, live${skip === undefined ? '' : ` (${skip})`}`,
  () => {
    const email = process.env.E2E_FLAGSMITH_EMAIL ?? '';
    const password = process.env.E2E_FLAGSMITH_PASSWORD ?? '';
    const logs = captureLogs();
    let dataDir: string;
    let db: Db;
    let app: App;

    beforeAll(async () => {
      dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-sign-in-live-'));
      db = openDatabase(dataDir);
      migrate(db);
      const logger = createLogger('debug', logs.destination);
      const client = liveClient();
      const sessions = createMemorySessionStore();
      app = await buildTestApp(logger, {
        sessions,
        auth: createAuthService({
          client,
          keyOrganisation: keyOrganisationResolver(client, liveOrganisationKey()),
          sessions,
          challenges: createMfaChallenges(),
          limiter: createAttemptLimiter(),
          db,
          logger,
        }),
      });
    });

    afterAll(async () => {
      await app.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('signs the operator in, reads the session and signs out, logging no credential', async () => {
      const signIn = await app.inject({
        method: 'POST',
        url: '/api/session',
        headers: writeHeaders,
        payload: { email, password },
      });
      expect(signIn.statusCode, JSON.stringify(signIn.json())).toBe(200);
      const cookie = String(signIn.headers['set-cookie']).split(';', 1)[0] ?? '';
      const { user } = signIn.json<{ user: { id: number; email: string } }>();
      expect(user.email.toLowerCase()).toBe(email.toLowerCase());

      const current = await app.inject({ url: '/api/session', headers: { cookie } });
      expect(current.statusCode).toBe(200);
      expect(current.json()).toEqual({ user });

      const out = await app.inject({
        method: 'DELETE',
        url: '/api/session',
        headers: { ...writeHeaders, cookie },
      });
      expect(out.statusCode).toBe(204);
      expect((await app.inject({ url: '/api/session', headers: { cookie } })).statusCode).toBe(401);

      expect(logs.text()).not.toContain(password);
      expect(logs.text()).not.toContain(email);
    });
  },
);

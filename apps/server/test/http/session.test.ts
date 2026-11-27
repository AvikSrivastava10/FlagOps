import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttemptLimiter } from '../../src/auth/attempt-limiter.js';
import { createAuthService } from '../../src/auth/login.js';
import { createMfaChallenges } from '../../src/auth/mfa.js';
import { createMemorySessionStore, sessionIdleMs } from '../../src/auth/sessions.js';
import { openDatabase, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createFlagsmithClient } from '../../src/flagsmith/client.js';
import { keyOrganisationResolver } from '../../src/flagsmith/projects.js';
import type { App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildTestApp, writeHeaders } from '../helpers/app.js';
import { createFakeFlagsmith, type FakeFlagsmith } from '../helpers/fake-flagsmith.js';
import { organisationKey } from '../helpers/flagsmith-client.js';
import { captureLogs, type CapturedLogs } from '../helpers/log-capture.js';

const admin = {
  id: 7,
  email: 'operator@example.com',
  password: 'correct horse battery staple',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: { 1: 'ADMIN' as const },
};

let dataDir: string;
let db: Db;
let fake: FakeFlagsmith;
let app: App;
let logs: CapturedLogs;
let time: number;
let triggered: number;

/** The app with the real auth service, talking to the fake Flagsmith. */
async function makeApp(fetch: (request: Request) => Promise<Response> = fake.fetch): Promise<App> {
  logs = captureLogs();
  const logger = createLogger('debug', logs.destination);
  const client = createFlagsmithClient({
    baseUrl: 'http://flagsmith.test',
    logger,
    fetch,
    readRetryDelaysMs: [1, 1],
  });
  const sessions = createMemorySessionStore(() => time);
  return buildTestApp(logger, {
    sessions,
    auth: createAuthService({
      client,
      keyOrganisation: keyOrganisationResolver(client, organisationKey),
      sessions,
      challenges: createMfaChallenges(() => time),
      limiter: createAttemptLimiter({ now: () => time }),
      db,
      logger,
    }),
    triggerSync: () => {
      triggered += 1;
      return 'started';
    },
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-session-'));
  db = openDatabase(dataDir);
  migrate(db);
  fake = createFakeFlagsmith();
  // A copy, because some tests turn two-factor authentication on for this user.
  fake.state.users.push({ ...admin });
  time = 1_000_000;
  triggered = 0;
  app = await makeApp();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function signIn(body: Record<string, unknown> = { email: admin.email, password: admin.password }) {
  return app.inject({ method: 'POST', url: '/api/session', headers: writeHeaders, payload: body });
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = String(response.headers['set-cookie']);
  return header.split(';', 1)[0] ?? '';
}

function auditActions(): string[] {
  return db
    .prepare<[], { action: string }>('SELECT action FROM audit_log ORDER BY id')
    .all()
    .map((row) => row.action);
}

describe('POST /api/session with a token-mode Flagsmith', () => {
  it('signs an organisation admin in and sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const response = await signIn();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: 7, email: 'operator@example.com', displayName: 'Ada Lovelace' },
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^flagops_session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    expect(auditActions()).toEqual(['sign_in']);

    const current = await app.inject({
      url: '/api/session',
      headers: { cookie: cookieOf(response) },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ user: { id: 7 } });
  });

  it('never logs the password or the Flagsmith token, even at debug level', async () => {
    await signIn();
    const token = [...fake.state.tokens.keys()][0] ?? 'no token issued';

    expect(logs.text()).not.toContain(admin.password);
    expect(logs.text()).not.toContain(token);
    expect(logs.entries()).toContainEqual(expect.objectContaining({ userId: 7, msg: 'Signed in' }));
  });

  it('refuses a wrong password with auth_invalid_credentials', async () => {
    const response = await signIn({ email: admin.email, password: 'wrong' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'auth_invalid_credentials' } });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses an account that is not an admin of the organisation of the API key', async () => {
    fake.state.users.push({ ...admin, id: 8, email: 'viewer@example.com', roles: { 1: 'USER' } });
    fake.state.users.push({ ...admin, id: 9, email: 'outsider@example.com', roles: {} });

    for (const email of ['viewer@example.com', 'outsider@example.com']) {
      const response = await signIn({ email, password: admin.password });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: {
          code: 'auth_not_org_admin',
          message: 'This Flagsmith account is not an admin of FlagOps Demo.',
        },
      });
    }
  });

  it('validates the body', async () => {
    const response = await signIn({ email: '', password: 'x' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('POST /api/session with two-factor authentication', () => {
  beforeEach(() => {
    const user = fake.state.users[0];
    if (user !== undefined) {
      user.mfaCode = '123456';
    }
  });

  it('asks for the code, then signs in with it', async () => {
    const challenge = await signIn();
    expect(challenge.statusCode).toBe(202);
    const { challengeId } = challenge.json<{ mfaRequired: true; challengeId: string }>();
    expect(challenge.json()).toEqual({ mfaRequired: true, challengeId });
    expect(challenge.headers['set-cookie']).toBeUndefined();

    const response = await app.inject({
      method: 'POST',
      url: '/api/session/mfa',
      headers: writeHeaders,
      payload: { challengeId, code: '123456' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: 7 } });
    expect(cookieOf(response)).toMatch(/^flagops_session=/);
  });

  it('refuses a wrong code, and closes the challenge after five', async () => {
    const { challengeId } = (await signIn()).json<{ challengeId: string }>();
    const attempt = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/api/session/mfa',
        headers: writeHeaders,
        payload: { challengeId, code },
      });

    for (let wrong = 1; wrong <= 5; wrong += 1) {
      const response = await attempt('000000');
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'auth_mfa_invalid' } });
    }
    const closed = await attempt('123456');
    expect(closed.statusCode).toBe(401);
    expect(closed.json<{ error: { message: string } }>().error.message).toContain('Sign in again');
  });

  it('closes the challenge after 5 minutes', async () => {
    const { challengeId } = (await signIn()).json<{ challengeId: string }>();
    time += 5 * 60 * 1000 + 1;

    const response = await app.inject({
      method: 'POST',
      url: '/api/session/mfa',
      headers: writeHeaders,
      payload: { challengeId, code: '123456' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/session with a cookie-mode Flagsmith', () => {
  it('keeps the jwt cookie Flagsmith sets and signs in with it', async () => {
    fake.cookieMode = true;

    const response = await signIn();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: 7 } });
  });
});

describe('sign-in limits and failures', () => {
  it('allows 10 attempts per 5 minutes from one address, then answers auth_rate_limited', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await signIn({ email: admin.email, password: 'wrong' })).statusCode).toBe(401);
    }

    const limited = await signIn();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: 'auth_rate_limited', details: { retryAfter: 300 } },
    });

    time += 5 * 60 * 1000;
    expect((await signIn()).statusCode).toBe(200);
  });

  it("passes Flagsmith's own throttle on as auth_rate_limited", async () => {
    fake.failNext(/\/auth\/login\/$/, 429, { detail: 'Request was throttled.' });

    const response = await signIn();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: 'auth_rate_limited',
        message: 'Flagsmith is limiting sign-in attempts. Try again in 60 seconds.',
      },
    });
  });

  it('answers flagsmith_unreachable (503) when Flagsmith is down', async () => {
    await app.close();
    app = await makeApp(() => Promise.reject(new TypeError('fetch failed')));

    const response = await signIn();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'flagsmith_unreachable' } });
  });
});

describe('sessions', () => {
  it('end after 8 idle hours', async () => {
    const cookie = cookieOf(await signIn());
    time += sessionIdleMs + 1;

    const response = await app.inject({ url: '/api/session', headers: { cookie } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'auth_required' } });
  });

  it('end on sign-out, which clears the cookie and is audited', async () => {
    const cookie = cookieOf(await signIn());

    const out = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { ...writeHeaders, cookie },
    });

    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^flagops_session=; /);
    expect((await app.inject({ url: '/api/session', headers: { cookie } })).statusCode).toBe(401);
    expect(auditActions()).toEqual(['sign_in', 'sign_out']);
  });

  it('end when Flagsmith rejects the session credential', async () => {
    // Stands for any route that calls Flagsmith with the operator's credential.
    app.get('/api/test/flagsmith-call', () => {
      throw new FlagOpsError(
        'flagsmith_session_expired',
        'Flagsmith no longer accepts your session. Sign in again.',
      );
    });
    const cookie = cookieOf(await signIn());

    const response = await app.inject({ url: '/api/test/flagsmith-call', headers: { cookie } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'flagsmith_session_expired' } });
    expect(String(response.headers['set-cookie'])).toMatch(/^flagops_session=; /);
    expect((await app.inject({ url: '/api/session', headers: { cookie } })).statusCode).toBe(401);
  });

  it('are required by every API route except health and sign-in', async () => {
    expect((await app.inject('/api/session')).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/sync', headers: writeHeaders })).statusCode,
    ).toBe(401);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });
});

describe('cross-site request checks', () => {
  it('refuses a write without the X-FlagOps-Request header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { email: admin.email, password: admin.password },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'csrf_rejected' } });
    expect(fake.requests).toEqual([]);
  });

  it('refuses a write from a page on another site', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { ...writeHeaders, origin: 'https://evil.example' },
      payload: { email: admin.email, password: admin.password },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'csrf_rejected' } });
  });

  it('accepts a write whose Origin is an allowed host', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { ...writeHeaders, origin: 'http://localhost:3000' },
      payload: { email: admin.email, password: admin.password },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/sync', () => {
  it('starts a sync for a signed-in operator', async () => {
    const cookie = cookieOf(await signIn());

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { ...writeHeaders, cookie },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'started' });
    expect(triggered).toBe(1);
  });
});

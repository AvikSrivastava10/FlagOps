import { FlagOpsError, type OwnerMappingInput } from '@flagops/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemorySessionStore } from '../../src/auth/sessions.js';
import { Secret } from '../../src/config/secret.js';
import type { App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildTestApp, writeHeaders } from '../helpers/app.js';
import { captureLogs } from '../helpers/log-capture.js';

// POST /api/scans and the owner-mapping routes over HTTP, with a prepared session
// (architecture.md 15).

let app: App;
let cookie: string;
let scanned: (string | undefined)[];
let saved: readonly OwnerMappingInput[];

beforeEach(async () => {
  const sessions = createMemorySessionStore();
  const session = sessions.create({
    user: { id: 7, email: 'operator@example.com', displayName: 'Demo Operator' },
    credential: { kind: 'user_token', token: new Secret('test-user-token-000001') },
  });
  cookie = `flagops_session=${session.id}`;
  scanned = [];
  saved = [];
  app = await buildTestApp(createLogger('error', captureLogs().destination), {
    sessions,
    triggerScan: (repository) => {
      if (repository === 'someone/else') {
        throw new FlagOpsError('github_repo_not_allowed', 'someone/else is not tracked.');
      }
      scanned.push(repository);
      return 'started';
    },
    ownerMappings: {
      directory: () =>
        Promise.resolve({
          users: [
            { id: 7, email: 'operator@example.com', firstName: 'Demo', lastName: 'Operator' },
          ],
          groups: [],
        }),
      save: (mappings) => {
        saved = mappings;
        return Promise.resolve([...mappings]);
      },
    },
  });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/scans', () => {
  it('starts a scan of every repository, or of the one named', async () => {
    const all = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { ...writeHeaders, cookie },
    });
    const one = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { ...writeHeaders, cookie },
      payload: { repository: 'AvikSrivastava10/flagops-demo-shop' },
    });

    expect([all.statusCode, one.statusCode]).toEqual([202, 202]);
    expect(one.json()).toEqual({ status: 'started' });
    expect(scanned).toEqual([undefined, 'AvikSrivastava10/flagops-demo-shop']);
  });

  it('refuses an untracked repository, and requests without a session or the CSRF header', async () => {
    const untracked = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { ...writeHeaders, cookie },
      payload: { repository: 'someone/else' },
    });
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: writeHeaders,
    });
    const noHeader = await app.inject({ method: 'POST', url: '/api/scans', headers: { cookie } });

    expect(untracked.statusCode).toBe(403);
    expect(untracked.json()).toMatchObject({ error: { code: 'github_repo_not_allowed' } });
    expect(anonymous.statusCode).toBe(401);
    expect(noHeader.statusCode).toBe(403);
  });
});

describe('owner mappings', () => {
  it('lists the directory and saves mappings', async () => {
    const directory = await app.inject({
      method: 'GET',
      url: '/api/flagsmith/directory',
      headers: { cookie },
    });
    const mappings = [{ github: '@AvikSrivastava10', kind: 'user', flagsmithUserId: 7 }];
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/owner-mappings',
      headers: { ...writeHeaders, cookie },
      payload: { mappings },
    });

    expect(directory.json()).toMatchObject({ users: [{ id: 7 }], groups: [] });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ mappings });
    expect(saved).toEqual(mappings);
  });

  it.each([
    {
      mapping: { github: '@acme/platform', kind: 'user', flagsmithUserId: 7 },
      reason: 'a team handle as a user',
    },
    {
      mapping: { github: '@name', kind: 'team', flagsmithGroupId: 3 },
      reason: 'a user handle as a team',
    },
    { mapping: { github: '@name', kind: 'user' }, reason: 'a user mapping without a user ID' },
    {
      mapping: { github: 'not a handle', kind: 'user', flagsmithUserId: 7 },
      reason: 'an invalid handle',
    },
  ])('refuses $reason', async ({ mapping }) => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/owner-mappings',
      headers: { ...writeHeaders, cookie },
      payload: { mappings: [mapping] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect(saved).toEqual([]);
  });
});

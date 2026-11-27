import { FlagOpsError } from '@flagops/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { Secret } from '../config/secret.js';
import { createLogger } from '../logger.js';
import { createFlagsmithClient, parseResponse, readAllPages } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { listProjects } from './projects.js';

const organisationKey: FlagsmithCredential = {
  kind: 'organisation_key',
  key: new Secret('test-organisation-key-0001'),
};
const userToken: FlagsmithCredential = {
  kind: 'user_token',
  token: new Secret('test-user-token-000001'),
};

/** A client whose Flagsmith answers each request with the next response, and counts the calls. */
function clientAnswering(...answers: (Response | Error)[]) {
  const logs = captureLogs();
  const seen: Request[] = [];
  const client = createFlagsmithClient({
    baseUrl: 'http://flagsmith.test',
    logger: createLogger('debug', logs.destination),
    readRetryDelaysMs: [1, 1],
    fetch: async (request) => {
      seen.push(request);
      const answer = answers.shift() ?? new Error('no answer left');
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  });
  return { client, seen, logs };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'flagsmith-version': '2.295.2', ...headers } });
}

async function errorOf(promise: Promise<unknown>): Promise<FlagOpsError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof FlagOpsError)) {
    throw new Error(`expected a FlagOpsError, got ${String(error)}`);
  }
  return error;
}

describe('createFlagsmithClient', () => {
  it('returns JSON bodies and records the Flagsmith version', async () => {
    const { client } = clientAnswering(json(200, []));

    await expect(listProjects(client, organisationKey)).resolves.toEqual([]);
    expect(client.observedVersion()).toBe('2.295.2');
  });

  it('treats the dashboard HTML that Flagsmith serves for unknown paths as an unexpected response', async () => {
    const { client } = clientAnswering(
      new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const error = await errorOf(listProjects(client, organisationKey));
    expect(error.code).toBe('flagsmith_unexpected_response');
    expect(error.message).toContain('tested with Flagsmith 2.295.2');
  });

  it('reports a body that lacks a field FlagOps relies on as an unexpected response', async () => {
    const { client } = clientAnswering(json(200, [{ id: 1, name: 'Shop' }]));

    const error = await errorOf(listProjects(client, organisationKey));
    expect(error.code).toBe('flagsmith_unexpected_response');
  });

  it.each([
    [organisationKey, 401, 'flagsmith_auth_failed'],
    [organisationKey, 403, 'flagsmith_auth_failed'],
    [userToken, 401, 'flagsmith_session_expired'],
    [userToken, 403, 'flagsmith_forbidden'],
  ] as const)('maps %o with HTTP %i to %s', async (credential, status, code) => {
    const { client } = clientAnswering(json(status, { detail: 'No.' }));

    const error = await errorOf(
      client.api.GET('/api/v1/projects/', { headers: authHeaders(credential) }),
    );
    expect(error.code).toBe(code);
  });

  it('maps 404 to flagsmith_not_found and 400 to flagsmith_validation with the messages', async () => {
    const { client } = clientAnswering(
      json(404, { detail: 'Not found.' }),
      json(400, { name: ['A metadata field with this name already exists.'] }),
    );

    expect((await errorOf(listProjects(client, organisationKey))).code).toBe('flagsmith_not_found');
    const validation = await errorOf(
      client.api.POST('/api/v1/metadata/fields/', {
        body: { name: 'flagops_type', organisation: 1 },
        headers: authHeaders(organisationKey),
      }),
    );
    expect(validation.code).toBe('flagsmith_validation');
    expect(validation.message).toContain('name: A metadata field with this name already exists');
  });

  it('maps the change-request refusal to flagsmith_change_requests_enabled', async () => {
    // The flag API answers writes this way; the mapping does not depend on the path.
    const { client } = clientAnswering(
      json(409, { detail: 'Cannot make this change.', code: 'change_requests_enabled' }),
    );

    const error = await errorOf(
      client.api.POST('/api/v1/projects/', {
        body: { name: 'Shop', organisation: 1 },
        headers: authHeaders(organisationKey),
      }),
    );
    expect(error.code).toBe('flagsmith_change_requests_enabled');
  });

  it('maps 429 to flagsmith_rate_limited with the wait from Retry-After', async () => {
    const { client } = clientAnswering(
      json(429, { detail: 'Slow down.' }, { 'retry-after': '17' }),
    );

    const error = await errorOf(listProjects(client, organisationKey));
    expect(error.code).toBe('flagsmith_rate_limited');
    expect(error.details).toEqual({ retryAfter: 17 });
  });

  it('retries a read twice after a server error, then succeeds', async () => {
    const { client, seen } = clientAnswering(
      json(502, { detail: 'Bad gateway' }),
      json(503, { detail: 'Unavailable' }),
      json(200, []),
    );

    await expect(listProjects(client, organisationKey)).resolves.toEqual([]);
    expect(seen).toHaveLength(3);
  });

  it('gives up on a read after two retries with flagsmith_server_error', async () => {
    const { client, seen } = clientAnswering(json(500, {}), json(500, {}), json(500, {}));

    expect((await errorOf(listProjects(client, organisationKey))).code).toBe(
      'flagsmith_server_error',
    );
    expect(seen).toHaveLength(3);
  });

  it('reports flagsmith_unreachable when the connection keeps failing', async () => {
    const refused = new TypeError('fetch failed');
    const { client, seen } = clientAnswering(refused, refused, refused);

    const error = await errorOf(listProjects(client, organisationKey));
    expect(error.code).toBe('flagsmith_unreachable');
    expect(error.message).toContain('http://flagsmith.test');
    expect(seen).toHaveLength(3);
  });

  it('never retries a write', async () => {
    const { client, seen } = clientAnswering(json(500, {}));

    const error = await errorOf(
      client.api.POST('/api/v1/projects/', {
        body: { name: 'Shop', organisation: 1 },
        headers: authHeaders(organisationKey),
      }),
    );
    expect(error.code).toBe('flagsmith_server_error');
    expect(seen).toHaveLength(1);
  });

  it('logs the method, path and status at debug, never the query string or a credential', async () => {
    const { client, logs } = clientAnswering(json(200, { next: null, results: [] }));

    await client.api.GET('/api/v1/environments/', {
      params: { query: { project: 1, page: 1 } },
      headers: authHeaders(organisationKey),
    });
    expect(logs.entries()).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/api/v1/environments/', status: 200 }),
    );
    expect(logs.text()).not.toContain('project=1');
    expect(logs.text()).not.toContain('test-organisation-key-0001');
  });
});

describe('readAllPages', () => {
  it('follows next until it is null', async () => {
    const pages = [
      { next: 'page 2', results: [1, 2] },
      { next: 'page 3', results: [3] },
      { next: null, results: [4] },
    ];
    const requested: number[] = [];

    const items = await readAllPages(async (page) => {
      requested.push(page);
      return pages[page - 1] ?? { next: null, results: [] };
    });

    expect(items).toEqual([1, 2, 3, 4]);
    expect(requested).toEqual([1, 2, 3]);
  });
});

describe('response validation', () => {
  it('names where the body went wrong', async () => {
    const { client } = clientAnswering(json(200, [{ id: 'one' }]));
    const { data } = await client.api.GET('/api/v1/projects/', {
      headers: authHeaders(organisationKey),
    });

    expect(() =>
      parseResponse(client, z.array(z.object({ id: z.number() })), data, {
        method: 'GET',
        path: '/api/v1/projects/',
      }),
    ).toThrow(/at 0\.id/);
  });
});

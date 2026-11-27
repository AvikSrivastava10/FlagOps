import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeGitHub } from '../../test/helpers/fake-github.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { Secret } from '../config/secret.js';
import { createLogger } from '../logger.js';
import { createGitHubClient, type GitHubClientOptions } from './client.js';

const repository = 'demo-owner/demo-shop';
const getRepository = {
  method: 'GET',
  repository,
  path: '',
  schema: z.object({ default_branch: z.string() }),
} as const;

let github: FakeGitHub;

beforeEach(async () => {
  github = await FakeGitHub.start();
  github.addRepository(repository, { files: { 'README.md': '# Demo shop\n' } });
});

afterEach(async () => {
  await github.close();
});

function client(overrides: Partial<GitHubClientOptions> = {}) {
  return createGitHubClient({
    token: new Secret(github.token),
    repositories: [repository],
    baseUrl: github.url,
    contentIntervalMs: 0,
    retryDelaysMs: [0, 0],
    ...overrides,
  });
}

function failEveryPath(status: number, headers: Record<string, string> = {}, message?: string) {
  github.failNext(
    { path: /.*/ },
    { status, headers, body: { message: message ?? 'GitHub says no' } },
  );
}

describe('GitHub client', () => {
  it('sends the token, the API version and the user agent GitHub asks for', async () => {
    await client().request(getRepository);

    expect(github.requests[0]?.headers).toMatchObject({
      authorization: `Bearer ${github.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2026-03-10',
      'user-agent': 'flagops',
    });
  });

  it('refuses a repository outside the allowlist before sending anything', async () => {
    github.addRepository('someone/else');

    await expect(
      client().request({ ...getRepository, repository: 'someone/else' }),
    ).rejects.toMatchObject({
      code: 'github_repo_not_allowed',
    });
    expect(github.requests).toEqual([]);
  });

  it('refuses a path that climbs out of the allowed repository', async () => {
    github.addRepository('someone/else');

    await expect(
      client().request({
        method: 'PATCH',
        repository,
        path: '/../../someone/else/pulls/1',
        body: { state: 'closed' },
        schema: z.unknown(),
      }),
    ).rejects.toMatchObject({ code: 'github_repo_not_allowed' });
    expect(github.requests).toEqual([]);
  });

  it('refuses a write that names no repository', async () => {
    await expect(
      client().request({ method: 'POST', path: '/user/repos', body: {}, schema: z.unknown() }),
    ).rejects.toMatchObject({ code: 'github_repo_not_allowed' });
    expect(github.requests).toEqual([]);
  });

  it('compares repository names as GitHub does, ignoring case', async () => {
    await expect(
      client().request({ ...getRepository, repository: 'Demo-Owner/Demo-Shop' }),
    ).resolves.toEqual({ default_branch: 'main' });
  });

  it.each([
    [401, 'github_bad_credentials'],
    [404, 'github_not_found'],
    [409, 'github_conflict'],
    [422, 'github_validation'],
    [429, 'github_rate_limited'],
  ])('maps %i to %s', async (status, code) => {
    failEveryPath(status);

    await expect(client().request(getRepository)).rejects.toMatchObject({ code });
  });

  it('names the permission a 403 asks for', async () => {
    failEveryPath(
      403,
      { 'x-accepted-github-permissions': 'contents=write; workflows=write' },
      'Resource not accessible by personal access token',
    );

    const error: unknown = await client()
      .request(getRepository)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'github_missing_permission',
      details: { permissions: 'contents=write; workflows=write', status: 403 },
    });
    expect(String(error)).toContain(
      'Resource not accessible by personal access token. It accepts a GITHUB_TOKEN with contents=write or workflows=write.',
    );
  });

  it('retries an idempotent GET twice after a 5xx', async () => {
    failEveryPath(502);
    failEveryPath(503);

    await expect(client().request(getRepository)).resolves.toEqual({ default_branch: 'main' });
    expect(github.requests).toHaveLength(3);
  });

  it('gives up on a GET after the second retry', async () => {
    failEveryPath(500);
    failEveryPath(500);
    failEveryPath(500);

    await expect(client().request(getRepository)).rejects.toMatchObject({
      code: 'github_server_error',
    });
    expect(github.requests).toHaveLength(3);
  });

  it('never retries a write', async () => {
    failEveryPath(502);

    const closing = client().request({
      method: 'PATCH',
      repository,
      path: '/pulls/1',
      body: { state: 'closed' },
      createsContent: true,
      schema: z.unknown(),
    });

    await expect(closing).rejects.toMatchObject({ code: 'github_server_error' });
    expect(github.requests).toHaveLength(1);
  });

  it('reports GitHub as unreachable when the connection fails', async () => {
    const closed = await FakeGitHub.start();
    const url = closed.url;
    await closed.close();

    await expect(client({ baseUrl: url }).request(getRepository)).rejects.toMatchObject({
      code: 'github_unreachable',
    });
  });

  it('reports a response without the fields FlagOps reads', async () => {
    github.failNext({ path: /.*/ }, { status: 200, body: { name: 'demo-shop' } });

    await expect(client().request(getRepository)).rejects.toMatchObject({
      code: 'github_server_error',
    });
    expect(github.requests).toHaveLength(1);
  });

  it('sends nothing more until the primary rate limit resets', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    failEveryPath(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) });
    const api = client();

    await expect(api.request(getRepository)).rejects.toMatchObject({
      code: 'github_rate_limited',
      details: { resetAt: new Date(reset * 1000).toISOString() },
    });
    await expect(api.request(getRepository)).rejects.toMatchObject({ code: 'github_rate_limited' });
    expect(github.requests).toHaveLength(1);
  });

  it('waits out a secondary rate limit before its next request', async () => {
    failEveryPath(403, { 'retry-after': '1' }, 'You have exceeded a secondary rate limit');
    const api = client();

    await expect(api.request(getRepository)).rejects.toMatchObject({
      code: 'github_rate_limited',
      details: { retryAfterSeconds: 1 },
    });
    await api.request(getRepository);

    const [limited, next] = github.requests;
    expect(next!.at - limited!.at).toBeGreaterThanOrEqual(900);
  });

  it('sends content-creating requests one at a time, spaced apart', async () => {
    const api = client({ contentIntervalMs: 150 });
    const createCommit = (message: string) =>
      api.request({
        method: 'POST',
        repository,
        path: '/git/commits',
        body: { message, tree: 'a'.repeat(40), parents: [] },
        createsContent: true,
        schema: z.object({ sha: z.string() }),
      });

    await Promise.all([createCommit('one'), createCommit('two'), createCommit('three')]);

    const times = github.requests.map((request) => request.at);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(140);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(140);
  });

  it('follows Link headers to the last page', async () => {
    for (let index = 0; index < 5; index += 1) {
      github.addPullRequest(repository, { headBranch: `feature/${index}` });
    }

    const pulls = await client().paginate({
      method: 'GET',
      repository,
      path: '/pulls',
      query: { state: 'open', per_page: 2 },
      schema: z.array(z.object({ number: z.number() })),
    });

    expect(pulls.map((pull) => pull.number)).toEqual([1, 2, 3, 4, 5]);
    expect(github.requests).toHaveLength(3);
  });

  it('logs each request at debug without its query or the token', async () => {
    const logs = captureLogs();

    await client({ logger: createLogger('debug', logs.destination) }).request({
      ...getRepository,
      query: { secret_query: 'value' },
    });

    expect(logs.entries()).toEqual([
      expect.objectContaining({ method: 'GET', path: `/repos/${repository}`, status: 200 }),
    ]);
    expect(logs.text()).not.toContain(github.token);
    expect(logs.text()).not.toContain('secret_query');
  });
});

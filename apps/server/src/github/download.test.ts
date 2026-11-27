import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../test/helpers/fake-github.js';
import { Secret } from '../config/secret.js';
import { createGitHubClient } from './client.js';
import { isAllowedRedirect, readCapped } from './download.js';
import { downloadTarball } from './git-data.js';

const request = 'GET /repos/o/r/tarball/abc';

describe('isAllowedRedirect', () => {
  it.each([
    ['https://codeload.github.com/o/r/legacy.tar.gz/abc', undefined, true],
    ['http://codeload.github.com/o/r/legacy.tar.gz/abc', undefined, false],
    ['https://codeload.github.com.example.com/o/r', undefined, false],
    ['https://api.github.com/repos/o/r/tarball/abc', undefined, false],
    ['http://127.0.0.1:4000/_codeload/o/r', undefined, false],
    ['http://127.0.0.1:4000/_codeload/o/r', 'http://127.0.0.1:4000', true],
    ['http://127.0.0.1:4001/_codeload/o/r', 'http://127.0.0.1:4000', false],
  ])('%s with the test origin %s: %s', (target, testOrigin, allowed) => {
    expect(isAllowedRedirect(new URL(target), testOrigin)).toBe(allowed);
  });
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

describe('readCapped', () => {
  it('returns a body within the limit', async () => {
    const bytes = await readCapped(new Response(streamOf('abc', 'def')), request, 6);

    expect(Buffer.from(bytes).toString('utf8')).toBe('abcdef');
  });

  it('refuses a body whose Content-Length is over the limit before reading it', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = new Response(body, { headers: { 'content-length': '10' } });

    await expect(readCapped(response, request, 6)).rejects.toMatchObject({
      code: 'github_validation',
      message: `${request} is larger than 6 bytes.`,
    });
    expect(pulled).toBe(false);
  });

  it('refuses a body without Content-Length once more than the limit has arrived', async () => {
    await expect(
      readCapped(new Response(streamOf('abcd', 'efgh', 'ijkl')), request, 6),
    ).rejects.toMatchObject({ code: 'github_validation' });
  });
});

describe('downloadTarball', () => {
  const repository = 'demo-owner/demo-shop';
  let github: FakeGitHub;

  beforeEach(async () => {
    github = await FakeGitHub.start();
    github.addRepository(repository, { files: { 'src/a.ts': 'export const a = 1;\n' } });
  });

  afterEach(async () => {
    await github.close();
  });

  function client() {
    return createGitHubClient({
      token: new Secret(github.token),
      repositories: [repository],
      baseUrl: github.url,
      retryDelaysMs: [0, 0],
    });
  }

  it("follows the API's redirect to the download host, without the token", async () => {
    const archive = await downloadTarball(client(), repository, github.head(repository) ?? '');

    expect(gunzipSync(archive).toString('latin1')).toContain('export const a = 1;');
    const [api, download] = github.requests;
    expect(api?.headers.authorization).toBe(`Bearer ${github.token}`);
    expect(download?.path).toMatch(/^\/_codeload\//);
    expect(download?.headers.authorization).toBeUndefined();
  });

  it('refuses a redirect to any other host, naming only its origin', async () => {
    github.failNext(
      { path: /\/tarball\// },
      { status: 302, headers: { location: 'https://elsewhere.example/o/r.tar.gz?token=abc' } },
    );

    const error: unknown = await downloadTarball(
      client(),
      repository,
      github.head(repository) ?? '',
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'github_server_error' });
    expect(String(error)).toContain('a redirect to https://elsewhere.example');
    expect(String(error)).not.toContain('token=abc');
    expect(github.requests).toHaveLength(1);
  });
});

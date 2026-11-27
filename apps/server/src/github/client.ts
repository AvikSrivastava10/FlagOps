import type { Logger } from 'pino';
import type { z } from 'zod';
import type { Secret } from '../config/secret.js';
import {
  errorForResponse,
  GitHubError,
  isRetryable,
  unexpectedResponseError,
  unreachableError,
} from './errors.js';
import { isAllowedRedirect, readCapped } from './download.js';
import { RateLimiter, rateLimitOf } from './rate-limit.js';
import { RepoGuard } from './repo-guard.js';

/** The REST API version FlagOps is written against (architecture.md 7.2). */
const apiVersion = '2026-03-10';

export type GitHubRequest<T> = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  /** `owner/name`. When set, `path` is relative to `/repos/{owner}/{name}` and the guard applies. */
  repository?: string;
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  /** The fields FlagOps reads from the response; anything else is ignored. */
  schema: z.ZodType<T>;
  /** Blobs, trees, commits, refs, pull requests: serialised and spaced (architecture.md 7.3). */
  createsContent?: boolean;
};

export type GitHubClient = {
  request<T>(spec: GitHubRequest<T>): Promise<T>;
  /** Follows `Link: rel="next"` until the last page and returns the items of every page. */
  paginate<T>(spec: GitHubRequest<T[]>): Promise<T[]>;
  /**
   * Downloads a repository's binary resource, such as its tarball (architecture.md 7.2). The
   * redirect is followed only as `download.ts` allows, and the body is capped at 200 MB (19).
   */
  download(spec: { repository: string; path: string }): Promise<Uint8Array>;
};

export type GitHubClientOptions = {
  token: Secret;
  /** The only repositories requests may name (the repo guard). */
  repositories: readonly string[];
  logger?: Logger;
  /** Only tests pass another API base URL (architecture.md 7.2 and 19). */
  baseUrl?: string;
  /** Tests shorten the pacing and the retry delays; the product keeps the defaults. */
  contentIntervalMs?: number;
  retryDelaysMs?: readonly number[];
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultBaseUrl = 'https://api.github.com';

/** Downloads take longer than API calls (architecture.md 18.1). */
const downloadTimeoutMs = 60_000;

function messageOf(body: unknown): string | undefined {
  return typeof body === 'object' && body !== null && 'message' in body
    ? String(body.message)
    : undefined;
}

function parseJson(text: string): unknown {
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function withQuery(url: URL, query: Record<string, string | number> | undefined): URL {
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, String(value));
  }
  return url;
}

/** The next page's URL from a `Link` header, followed only on the API's own origin. */
function nextPage(link: string | null, origin: string): URL | undefined {
  const target = link
    ?.split(',')
    .map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1])
    .find((url) => url !== undefined);
  if (target === undefined) {
    return undefined;
  }
  const url = new URL(target);
  return url.origin === origin ? url : undefined;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, '');
  const origin = new URL(baseUrl).origin;
  // Only a test's own API server may stand in for the download host (architecture.md 19).
  const testOrigin = baseUrl === defaultBaseUrl ? undefined : origin;
  const guard = new RepoGuard(options.repositories);
  const retryDelaysMs = options.retryDelaysMs ?? [500, 1500];
  const timeoutMs = options.timeoutMs ?? 15_000;
  const limiter = new RateLimiter({
    contentIntervalMs: options.contentIntervalMs ?? 1000,
    now: Date.now,
    sleep,
  });

  function urlOf(
    spec: Pick<GitHubRequest<unknown>, 'method' | 'repository' | 'path' | 'query'>,
  ): URL {
    if (spec.repository === undefined) {
      if (spec.method !== 'GET') {
        throw new GitHubError(
          'github_repo_not_allowed',
          `FlagOps writes only to configured repositories, and ${spec.method} ${spec.path} names none.`,
        );
      }
      return withQuery(new URL(baseUrl + spec.path), spec.query);
    }
    guard.check(spec.repository);
    const root = `${baseUrl}/repos/${spec.repository.split('/').map(encodeURIComponent).join('/')}`;
    const url = new URL(root + spec.path);
    // URL parsing resolves `..` segments, which could lead to another repository.
    const rootPath = new URL(root).pathname;
    if (url.pathname !== rootPath && !url.pathname.startsWith(`${rootPath}/`)) {
      throw new GitHubError(
        'github_repo_not_allowed',
        `FlagOps refused ${spec.method} ${spec.path}: the path leaves ${spec.repository}.`,
        { details: { repository: spec.repository } },
      );
    }
    return withQuery(url, spec.query);
  }

  async function attempt<T>(spec: GitHubRequest<T>, url: URL) {
    const request = `${spec.method} ${url.pathname}`;
    await limiter.beforeRequest();
    const started = Date.now();
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method: spec.method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${options.token.reveal()}`,
          'User-Agent': 'flagops',
          'X-GitHub-Api-Version': apiVersion,
          ...(spec.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: spec.body === undefined ? null : JSON.stringify(spec.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (cause) {
      throw unreachableError(request, cause);
    }
    options.logger?.debug(
      {
        method: spec.method,
        host: url.host,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - started,
      },
      'GitHub request',
    );

    const body = parseJson(text);
    if (!response.ok) {
      const message = messageOf(body);
      const hit = rateLimitOf(response.status, response.headers, message, Date.now());
      if (hit !== undefined) {
        limiter.record(hit);
      }
      throw errorForResponse(
        {
          request,
          status: response.status,
          message,
          acceptedPermissions: response.headers.get('x-accepted-github-permissions'),
        },
        hit,
      );
    }
    const parsed = spec.schema.safeParse(body);
    if (!parsed.success) {
      throw unexpectedResponseError(request, parsed.error.issues[0]?.message ?? 'invalid body');
    }
    return { data: parsed.data, link: response.headers.get('link') };
  }

  /** Idempotent GETs are retried on network errors and 5xx; writes never are (18.1). */
  async function retried<T>(task: () => Promise<T>): Promise<T> {
    for (const delay of retryDelaysMs) {
      try {
        return await task();
      } catch (error) {
        if (!isRetryable(error)) {
          throw error;
        }
        await sleep(delay);
      }
    }
    return task();
  }

  async function send<T>(spec: GitHubRequest<T>, url: URL) {
    if (spec.createsContent === true) {
      return limiter.serialiseContent(() => attempt(spec, url));
    }
    return spec.method === 'GET' ? retried(() => attempt(spec, url)) : attempt(spec, url);
  }

  /** One download attempt: the API answers with a redirect, followed without the token. */
  async function downloadOnce(url: URL): Promise<Uint8Array> {
    const request = `GET ${url.pathname}`;
    await limiter.beforeRequest();
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${options.token.reveal()}`,
          'User-Agent': 'flagops',
          'X-GitHub-Api-Version': apiVersion,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(downloadTimeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const target = new URL(response.headers.get('location') ?? '', url);
        // The origin only: a download URL can carry a token in its query.
        if (!isAllowedRedirect(target, testOrigin)) {
          throw unexpectedResponseError(request, `a redirect to ${target.origin}`);
        }
        response = await fetch(target, {
          headers: { 'User-Agent': 'flagops' },
          redirect: 'error',
          signal: AbortSignal.timeout(downloadTimeoutMs),
        });
      }
      if (!response.ok) {
        const message = messageOf(parseJson(await response.text()));
        const hit = rateLimitOf(response.status, response.headers, message, Date.now());
        if (hit !== undefined) {
          limiter.record(hit);
        }
        throw errorForResponse(
          {
            request,
            status: response.status,
            message,
            acceptedPermissions: response.headers.get('x-accepted-github-permissions'),
          },
          hit,
        );
      }
      const bytes = await readCapped(response, request);
      options.logger?.debug(
        {
          method: 'GET',
          host: url.host,
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - started,
        },
        'GitHub download',
      );
      return bytes;
    } catch (cause) {
      throw cause instanceof GitHubError ? cause : unreachableError(request, cause);
    }
  }

  return {
    async request<T>(spec: GitHubRequest<T>): Promise<T> {
      return (await send(spec, urlOf(spec))).data;
    },
    async paginate<T>(spec: GitHubRequest<T[]>): Promise<T[]> {
      const items: T[] = [];
      let url: URL | undefined = urlOf(spec);
      while (url !== undefined) {
        const page = await send(spec, url);
        items.push(...page.data);
        url = nextPage(page.link, origin);
      }
      return items;
    },
    async download(spec) {
      const url = urlOf({ method: 'GET', repository: spec.repository, path: spec.path });
      return retried(() => downloadOnce(url));
    },
  };
}

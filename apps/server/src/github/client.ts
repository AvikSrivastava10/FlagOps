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
  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const origin = new URL(baseUrl).origin;
  const guard = new RepoGuard(options.repositories);
  const retryDelaysMs = options.retryDelaysMs ?? [500, 1500];
  const timeoutMs = options.timeoutMs ?? 15_000;
  const limiter = new RateLimiter({
    contentIntervalMs: options.contentIntervalMs ?? 1000,
    now: Date.now,
    sleep,
  });

  function urlOf(spec: GitHubRequest<unknown>): URL {
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
  async function send<T>(spec: GitHubRequest<T>, url: URL) {
    if (spec.createsContent === true) {
      return limiter.serialiseContent(() => attempt(spec, url));
    }
    if (spec.method !== 'GET') {
      return attempt(spec, url);
    }
    for (const delay of retryDelaysMs) {
      try {
        return await attempt(spec, url);
      } catch (error) {
        if (!isRetryable(error)) {
          throw error;
        }
        await sleep(delay);
      }
    }
    return attempt(spec, url);
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
  };
}

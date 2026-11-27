import { setTimeout as sleep } from 'node:timers/promises';
import createClient, { type Client } from 'openapi-fetch';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { credentialKindOf } from './credentials.js';
import { errorForResponse, unexpectedResponse, unreachable, type RequestLabel } from './errors.js';
import type { paths } from './openapi/schema.js';

/** The typed Admin API client: request paths, parameters and bodies are checked against the pinned schema. */
export type FlagsmithApi = Client<paths>;

export type FlagsmithClient = {
  readonly api: FlagsmithApi;
  /** The release the latest Flagsmith response announced in its `Flagsmith-Version` header. */
  observedVersion(): string | undefined;
};

export type FlagsmithClientOptions = {
  /** The Flagsmith request URL (architecture.md section 2), without a trailing slash. */
  baseUrl: string;
  logger: Logger;
  /** Tests pass a fake Flagsmith here. */
  fetch?: (request: Request) => Promise<Response>;
  /** Pauses before the retries of a failed read (architecture.md 18.1); tests shorten them. */
  readRetryDelaysMs?: readonly number[];
};

const readTimeoutMs = 10_000;
const writeTimeoutMs = 30_000;

function isJsonContentType(response: Response): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '');
}

function hasBody(response: Response): boolean {
  return response.status !== 204 && response.headers.get('content-length') !== '0';
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!isJsonContentType(response)) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Creates the only client that talks to Flagsmith (architecture.md 4). Every request goes through
 * `send`, which:
 * - applies the timeouts of architecture.md 18.1 and retries a failed read twice;
 * - logs one debug line per attempt, with the path but never the query string or headers;
 * - records the `Flagsmith-Version` header;
 * - turns every failure into a typed FlagOps error, so callers only ever see successful JSON.
 *   Flagsmith answers unknown paths with its dashboard's HTML and status 200, so a successful
 *   response that is not JSON is an error too (architecture.md 6.5).
 */
export function createFlagsmithClient(options: FlagsmithClientOptions): FlagsmithClient {
  const baseFetch = options.fetch ?? ((request: Request) => fetch(request));
  const retryDelays = options.readRetryDelaysMs ?? [500, 1500];
  let version: string | undefined;

  async function send(request: Request): Promise<Response> {
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const label: RequestLabel = { method: request.method, path: new URL(request.url).pathname };
    const delays = isRead ? retryDelays : [];
    for (let attempt = 0; ; attempt += 1) {
      const startedAt = performance.now();
      const signal = AbortSignal.timeout(isRead ? readTimeoutMs : writeTimeoutMs);
      let response: Response;
      try {
        response = await baseFetch(new Request(isRead ? request.clone() : request, { signal }));
      } catch (error) {
        const delay = delays[attempt];
        options.logger.debug({ ...label, attempt, err: error }, 'Flagsmith request failed');
        if (delay === undefined) {
          throw unreachable(options.baseUrl, error);
        }
        await sleep(delay);
        continue;
      }
      version = response.headers.get('flagsmith-version') ?? version;
      options.logger.debug(
        {
          ...label,
          host: new URL(request.url).host,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          attempt,
        },
        'Flagsmith request',
      );
      const delay = delays[attempt];
      if (response.status >= 500 && delay !== undefined) {
        await response.body?.cancel();
        await sleep(delay);
        continue;
      }
      if (!response.ok) {
        throw errorForResponse({
          status: response.status,
          body: await readErrorBody(response),
          isJson: isJsonContentType(response),
          credential: credentialKindOf(request.headers),
          label,
          retryAfterSeconds: retryAfterSeconds(response),
          observedVersion: version,
        });
      }
      if (hasBody(response) && !isJsonContentType(response)) {
        await response.body?.cancel();
        throw unexpectedResponse(
          label,
          `content of type ${response.headers.get('content-type') ?? 'unknown'} instead of JSON`,
          version,
        );
      }
      return response;
    }
  }

  return {
    api: createClient<paths>({ baseUrl: options.baseUrl, fetch: send }),
    observedVersion: () => version,
  };
}

/**
 * Checks a response body against the fields FlagOps relies on (D-006). The generated types cover
 * requests; Flagsmith's published response schemas leave fields out, such as `django_id`, so
 * responses are validated at runtime instead.
 */
export function parseResponse<S extends z.ZodType>(
  client: FlagsmithClient,
  schema: S,
  data: unknown,
  label: RequestLabel,
): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue === undefined ? '' : ` at ${issue.path.join('.') || 'the top level'}`;
    throw unexpectedResponse(
      label,
      `a body FlagOps does not understand${where} (${issue?.message ?? 'invalid'})`,
      client.observedVersion(),
    );
  }
  return parsed.data;
}

/** One page of a DRF list: `{count, next, previous, results}`. */
export type Page<T> = { next: string | null; results: T[] };

/** Stops a misbehaving server from paging forever. */
const maxPages = 10_000;

/**
 * Reads every page of a list (architecture.md 6.3): it follows `next` until it is null. Some
 * Flagsmith lists accept `page_size` (up to 999); others page at a fixed 10 and accept only `page`.
 */
export async function readAllPages<T>(fetchPage: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { next, results } = await fetchPage(page);
    items.push(...results);
    if (next === null) {
      return items;
    }
  }
  throw new Error(`A Flagsmith list did not end within ${maxPages} pages`);
}

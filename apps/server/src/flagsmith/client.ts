import { setTimeout as sleep } from 'node:timers/promises';
import createClient, { type Client } from 'openapi-fetch';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { credentialKindOf } from './credentials.js';
import { errorForResponse, unexpectedResponse, unreachable, type RequestLabel } from './errors.js';
import type { paths } from './openapi/schema.js';
import { createWriteGuard, type WriteGuard } from './write-guard.js';

/** The typed Admin API client: request paths, parameters and bodies are checked against the pinned schema. */
export type FlagsmithApi = Client<paths>;

export type FlagsmithClient = {
  readonly api: FlagsmithApi;
  /** The release the latest Flagsmith response announced in its `Flagsmith-Version` header. */
  observedVersion(): string | undefined;
  /** What this process may write to (architecture.md 6.6); every write function checks it. */
  readonly writeGuard: WriteGuard;
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

/** The parsed body, or undefined when the text is not JSON (JSON itself never parses to undefined). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Creates the only client that talks to Flagsmith (architecture.md 4). Every request goes through
 * `send`, which:
 * - applies the timeouts of architecture.md 18.1 to the whole response, body included, and
 *   retries a failed read twice;
 * - logs one debug line per attempt, with the path but never the query string or headers;
 * - records the `Flagsmith-Version` header;
 * - turns every failure into a typed FlagOps error, so callers only ever see successful JSON.
 *   Flagsmith answers unknown paths with its dashboard's HTML and status 200, so a successful
 *   response that is not JSON is an error too (architecture.md 6.5).
 *
 * openapi-fetch reads the body only after `send` returns, outside its error handling. So `send`
 * reads the body itself, under the attempt's timeout, and hands openapi-fetch a response built from
 * the text it read: a body that stalls or is cut off fails the attempt like a refused connection.
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
      const delay = delays[attempt];
      const startedAt = performance.now();
      const signal = AbortSignal.timeout(isRead ? readTimeoutMs : writeTimeoutMs);
      let response: Response;
      let text: string;
      try {
        response = await baseFetch(new Request(isRead ? request.clone() : request, { signal }));
        text = await response.text();
      } catch (error) {
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
      if (response.status >= 500 && delay !== undefined) {
        await sleep(delay);
        continue;
      }
      const isJson = isJsonContentType(response);
      // openapi-fetch reads an empty body as "no data", so only a body with content must parse.
      const parsed = isJson && text !== '' ? parseJson(text) : text;
      const isValidJson = isJson && parsed !== undefined;
      if (!response.ok) {
        throw errorForResponse({
          status: response.status,
          body: parsed ?? text,
          isJson: isValidJson,
          credential: credentialKindOf(request.headers),
          label,
          retryAfterSeconds: retryAfterSeconds(response),
          observedVersion: version,
        });
      }
      if (!hasBody(response)) {
        return new Response(null, response);
      }
      if (!isValidJson) {
        throw unexpectedResponse(
          label,
          isJson
            ? 'a body that is not valid JSON'
            : `content of type ${response.headers.get('content-type') ?? 'unknown'} instead of JSON`,
          version,
        );
      }
      return new Response(text, response);
    }
  }

  return {
    api: createClient<paths>({ baseUrl: options.baseUrl, fetch: send }),
    observedVersion: () => version,
    writeGuard: createWriteGuard(),
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

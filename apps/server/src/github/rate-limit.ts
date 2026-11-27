import { rateLimitedError } from './errors.js';

/** A rate limit GitHub reported on a 403 or 429 response (architecture.md 7.3). */
export type RateLimitHit =
  { kind: 'primary'; resetAt: Date } | { kind: 'secondary'; retryAfterSeconds: number };

/** GitHub's default wait when a secondary limit comes without a `retry-after` header. */
const defaultSecondaryWaitSeconds = 60;

/**
 * Tells a rate limit from other refusals: a `retry-after` header or a "secondary rate limit"
 * message is the secondary limit; `x-ratelimit-remaining: 0` is the primary limit.
 */
export function rateLimitOf(
  status: number,
  headers: Headers,
  message: string | undefined,
  now: number,
): RateLimitHit | undefined {
  if (status !== 403 && status !== 429) {
    return undefined;
  }
  const retryAfter = Number(headers.get('retry-after') ?? Number.NaN);
  if (headers.has('retry-after') || /secondary rate limit/i.test(message ?? '')) {
    return {
      kind: 'secondary',
      retryAfterSeconds: retryAfter > 0 ? retryAfter : defaultSecondaryWaitSeconds,
    };
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset') ?? Number.NaN);
    return {
      kind: 'primary',
      resetAt: new Date(reset > 0 ? reset * 1000 : now + defaultSecondaryWaitSeconds * 1000),
    };
  }
  return status === 429
    ? { kind: 'secondary', retryAfterSeconds: defaultSecondaryWaitSeconds }
    : undefined;
}

export type RateLimiterOptions = {
  /** Minimum gap between content-creating requests. GitHub asks for at least one second. */
  contentIntervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Paces requests to GitHub (architecture.md 7.3): no request while the primary limit is used up,
 * a wait after a secondary limit, and content-creating requests one at a time, spaced apart.
 */
export class RateLimiter {
  readonly #options: RateLimiterOptions;
  #blockedUntil = 0;
  #pausedUntil = 0;
  #lastContentAt = Number.NEGATIVE_INFINITY;
  #contentQueue: Promise<unknown> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.#options = options;
  }

  /** Throws `github_rate_limited` until the primary limit resets; waits out a secondary pause. */
  async beforeRequest(): Promise<void> {
    const now = this.#options.now();
    if (now < this.#blockedUntil) {
      throw rateLimitedError({ kind: 'primary', resetAt: new Date(this.#blockedUntil) });
    }
    if (now < this.#pausedUntil) {
      await this.#options.sleep(this.#pausedUntil - now);
    }
  }

  record(hit: RateLimitHit): void {
    if (hit.kind === 'primary') {
      this.#blockedUntil = Math.max(this.#blockedUntil, hit.resetAt.getTime());
    } else {
      const until = this.#options.now() + hit.retryAfterSeconds * 1000;
      this.#pausedUntil = Math.max(this.#pausedUntil, until);
    }
  }

  /** Runs a content-creating request after every earlier one, at least the interval after it. */
  serialiseContent<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.#lastContentAt + this.#options.contentIntervalMs - this.#options.now();
      if (wait > 0) {
        await this.#options.sleep(wait);
      }
      try {
        return await task();
      } finally {
        this.#lastContentAt = this.#options.now();
      }
    };
    const result = this.#contentQueue.then(run, run);
    this.#contentQueue = result.catch(() => undefined);
    return result;
  }
}

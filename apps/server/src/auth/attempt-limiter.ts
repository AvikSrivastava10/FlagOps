export type AttemptLimiter = {
  /** Counts an attempt from the client; when over the limit, returns the seconds until the next is allowed. */
  attempt(client: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
};

/**
 * FlagOps' own limit on sign-in attempts: 10 per 5 minutes per client IP, on top of Flagsmith's
 * throttle (architecture.md 14.2). Behind a proxy, the client IP is only as trustworthy as the
 * proxy's `X-Forwarded-For` (architecture.md 19).
 */
export function createAttemptLimiter(
  options: { limit?: number; windowMs?: number; now?: () => number } = {},
): AttemptLimiter {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  return {
    attempt(client) {
      const time = now();
      const recent = (attempts.get(client) ?? []).filter((at) => time - at < windowMs);
      if (recent.length >= limit) {
        attempts.set(client, recent);
        const oldest = recent[0] ?? time;
        return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - time) / 1000) };
      }
      recent.push(time);
      attempts.set(client, recent);
      return { allowed: true };
    },
  };
}

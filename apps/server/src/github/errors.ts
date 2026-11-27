import { FlagOpsError } from '@flagops/shared';
import type { RateLimitHit } from './rate-limit.js';

/** A GitHub failure, as one of the `github_*` codes of architecture.md 18.1. */
export class GitHubError extends FlagOpsError {}

/** What FlagOps keeps of a failed response to explain it: never headers or bodies beyond these. */
export type FailedResponse = {
  /** Method and path without the query, for example "PATCH /repos/o/r/git/refs/heads/main". */
  request: string;
  status: number;
  /** GitHub's `message` field. */
  message: string | undefined;
  /** The `X-Accepted-GitHub-Permissions` header: the token permissions the endpoint accepts. */
  acceptedPermissions: string | null;
};

export function rateLimitedError(
  hit: RateLimitHit,
  details: Record<string, unknown> = {},
): GitHubError {
  if (hit.kind === 'primary') {
    const resetAt = hit.resetAt.toISOString();
    return new GitHubError(
      'github_rate_limited',
      `GitHub's rate limit for GITHUB_TOKEN is used up until ${resetAt}. Retry after that.`,
      { details: { ...details, resetAt } },
    );
  }
  return new GitHubError(
    'github_rate_limited',
    `GitHub's secondary rate limit was hit, so the next GitHub request waits ${hit.retryAfterSeconds} s. Retry the action.`,
    { details: { ...details, retryAfterSeconds: hit.retryAfterSeconds } },
  );
}

/** Maps a non-2xx response to its typed error (architecture.md 7.1, 7.3 and 18.1). */
export function errorForResponse(
  failed: FailedResponse,
  rateLimit: RateLimitHit | undefined,
): GitHubError {
  const { request, status, message, acceptedPermissions } = failed;
  const details = { request, status, ...(message === undefined ? {} : { githubMessage: message }) };
  const said = message === undefined ? '' : `: ${message}`;
  if (rateLimit !== undefined) {
    return rateLimitedError(rateLimit, details);
  }
  if (status === 401) {
    return new GitHubError(
      'github_bad_credentials',
      'GitHub rejected GITHUB_TOKEN as bad credentials. Create a new token and update GITHUB_TOKEN.',
      { details },
    );
  }
  if (status === 403) {
    // The header lists alternative permission sets, separated by semicolons.
    const accepted = acceptedPermissions
      ?.split(';')
      .map((set) => set.trim())
      .filter((set) => set !== '')
      .join(' or ');
    return new GitHubError(
      'github_missing_permission',
      accepted === undefined || accepted === ''
        ? `GitHub refused ${request}${said}. Check that GITHUB_TOKEN can access the repository.`
        : `GitHub refused ${request}${said}. It accepts a GITHUB_TOKEN with ${accepted}. Grant that permission to the token and retry.`,
      { details: { ...details, permissions: acceptedPermissions } },
    );
  }
  if (status === 404 || status === 410) {
    return new GitHubError(
      'github_not_found',
      `GitHub found nothing at ${request}. Check that the repository exists and GITHUB_TOKEN can see it.`,
      { details },
    );
  }
  if (status === 409) {
    return new GitHubError('github_conflict', `GitHub reported a conflict for ${request}${said}.`, {
      details,
    });
  }
  if (status >= 500) {
    return new GitHubError(
      'github_server_error',
      `GitHub answered ${request} with ${status}${said}. Retry later.`,
      { details },
    );
  }
  return new GitHubError('github_validation', `GitHub rejected ${request}${said}.`, { details });
}

export function unreachableError(request: string, cause: unknown): GitHubError {
  const reason = cause instanceof Error && cause.name === 'TimeoutError' ? 'timed out' : 'failed';
  return new GitHubError(
    'github_unreachable',
    `GitHub could not be reached: ${request} ${reason}. Check the network connection and retry.`,
    { details: { request }, cause },
  );
}

/** A 2xx response whose body does not have the fields FlagOps reads. */
export function unexpectedResponseError(request: string, issue: string): GitHubError {
  return new GitHubError(
    'github_server_error',
    `GitHub answered ${request} with a response FlagOps does not understand (${issue}).`,
    { details: { request, issue } },
  );
}

/** Network failures and 5xx answers to an idempotent request are worth retrying (18.1). */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof GitHubError)) {
    return false;
  }
  const status = error.details?.status;
  return (
    error.code === 'github_unreachable' ||
    (error.code === 'github_server_error' && typeof status === 'number' && status >= 500)
  );
}

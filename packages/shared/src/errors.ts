/**
 * Every error code the FlagOps API returns, with the HTTP status it maps to (architecture.md 18.1).
 * Codes are defined only here, so the server and the web app agree on them.
 */
export const errorHttpStatus = {
  flagsmith_unreachable: 503,
  flagsmith_auth_failed: 503,
  flagsmith_session_expired: 401,
  flagsmith_forbidden: 403,
  flagsmith_not_found: 404,
  flagsmith_validation: 422,
  flagsmith_change_requests_enabled: 409,
  flagsmith_rate_limited: 429,
  flagsmith_server_error: 502,
  flagsmith_unexpected_response: 502,
  github_not_configured: 409,
  github_unreachable: 503,
  github_bad_credentials: 503,
  github_missing_permission: 403,
  github_rate_limited: 429,
  github_not_found: 404,
  github_conflict: 409,
  github_validation: 422,
  github_server_error: 502,
  github_repo_not_allowed: 403,
  auth_required: 401,
  auth_invalid_credentials: 401,
  auth_mfa_required: 202,
  auth_mfa_invalid: 401,
  auth_not_org_admin: 403,
  auth_login_not_allowed: 403,
  auth_rate_limited: 429,
  csrf_rejected: 403,
  host_not_allowed: 403,
  validation_failed: 400,
  not_found: 404,
  identities_not_synced: 409,
  preview_stale: 409,
  preview_expired: 409,
  confirmation_mismatch: 400,
  promotion_blocked: 409,
  promotion_in_progress: 409,
  rollback_target_changed: 409,
  rollback_blocked: 409,
  retire_not_eligible: 409,
  dry_run_stale: 409,
  archive_blocked: 409,
  retirement_in_progress: 409,
  retirement_not_discardable: 409,
  internal_error: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorHttpStatus;

/** The body of every error response: `{ "error": { "code", "message", "details"? } }` (architecture.md 15). */
export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

/**
 * An error FlagOps expects and can explain. The code decides the HTTP status; the message is shown
 * to the operator, so it says what failed and what to do next.
 */
export class FlagOpsError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
  }

  get httpStatus(): number {
    return errorHttpStatus[this.code];
  }
}

import { FlagOpsError } from '@flagops/shared';
import type { CredentialKind } from './credentials.js';

/** The Flagsmith release FlagOps is built and tested against (architecture.md 6.1). */
const testedFlagsmithVersion = '2.295.2';

/** Where a failed request went, for messages: the method and the path without its query. */
export type RequestLabel = { method: string; path: string };

function describe(label: RequestLabel): string {
  return `${label.method} ${label.path}`;
}

/** Collects the human-readable strings of a DRF error body: `{detail}`, field lists or plain lists. */
function flagsmithMessages(body: unknown): string[] {
  if (typeof body === 'string') {
    return body.trim() === '' ? [] : [body];
  }
  if (Array.isArray(body)) {
    return body.flatMap(flagsmithMessages);
  }
  if (typeof body === 'object' && body !== null) {
    return Object.entries(body).flatMap(([field, value]) => {
      const messages = flagsmithMessages(value);
      const prefixed = field === 'detail' || field === 'non_field_errors' || field === 'message';
      return field === 'code'
        ? []
        : messages.map((text) => (prefixed ? text : `${field}: ${text}`));
    });
  }
  return [];
}

function codeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
}

export function unexpectedResponse(
  label: RequestLabel,
  problem: string,
  observedVersion: string | undefined,
): FlagOpsError {
  return new FlagOpsError(
    'flagsmith_unexpected_response',
    `Flagsmith answered ${describe(label)} with ${problem}. FlagOps is tested with Flagsmith ${testedFlagsmithVersion}; this instance runs ${observedVersion ?? 'an unknown version'}.`,
    { details: { testedVersion: testedFlagsmithVersion, runningVersion: observedVersion ?? null } },
  );
}

export function unreachable(baseUrl: string, cause: unknown): FlagOpsError {
  const reason =
    cause instanceof Error && cause.name === 'TimeoutError'
      ? 'the request timed out'
      : 'the connection failed';
  return new FlagOpsError(
    'flagsmith_unreachable',
    `FlagOps cannot reach Flagsmith at ${baseUrl}: ${reason}. Check that Flagsmith is running and that FLAGSMITH_URL, or FLAGSMITH_INTERNAL_URL when set, points at it.`,
    { cause },
  );
}

/**
 * Maps a Flagsmith error response to a FlagOps error (architecture.md 18.1). The credential kind
 * decides what a 401 or 403 means: a bad organisation key is a configuration problem, while a
 * rejected operator session means signing in again.
 */
export function errorForResponse(input: {
  status: number;
  body: unknown;
  isJson: boolean;
  credential: CredentialKind;
  label: RequestLabel;
  retryAfterSeconds: number | undefined;
  observedVersion: string | undefined;
}): FlagOpsError {
  const { status, body, credential, label } = input;
  const messages = flagsmithMessages(body).map((text) => text.replace(/[.!?]+$/, ''));
  const said = messages.length > 0 ? `: ${messages.join('; ')}` : '';
  if (status === 429) {
    const wait = input.retryAfterSeconds ?? 60;
    return new FlagOpsError(
      'flagsmith_rate_limited',
      `Flagsmith is limiting the rate of requests. Try again in ${wait} seconds.`,
      { details: { retryAfter: wait } },
    );
  }
  if (status >= 500) {
    return new FlagOpsError(
      'flagsmith_server_error',
      `Flagsmith failed with HTTP ${status} on ${describe(label)}. Background jobs try again at their next run.`,
      { details: { status } },
    );
  }
  if (!input.isJson) {
    return unexpectedResponse(
      label,
      `HTTP ${status} and a body that is not JSON`,
      input.observedVersion,
    );
  }
  if ((status === 401 || status === 403) && credential === 'organisation_key') {
    return new FlagOpsError(
      'flagsmith_auth_failed',
      `Flagsmith rejected the organisation API key (HTTP ${status}). Check FLAGSMITH_ORG_API_KEY: it must be an API key of the organisation FlagOps manages.`,
    );
  }
  if (status === 401) {
    return new FlagOpsError(
      'flagsmith_session_expired',
      'Flagsmith no longer accepts your session. Sign in again.',
    );
  }
  if (status === 403) {
    return new FlagOpsError(
      'flagsmith_forbidden',
      `Flagsmith refused ${describe(label)} for this account${said}.`,
      { details: { messages } },
    );
  }
  if (status === 404) {
    return new FlagOpsError(
      'flagsmith_not_found',
      `Flagsmith found nothing at ${label.path}${said}.`,
    );
  }
  if (status === 409 && codeOf(body) === 'change_requests_enabled') {
    return new FlagOpsError(
      'flagsmith_change_requests_enabled',
      'Flagsmith refused the write because this environment requires change requests, which FlagOps does not create.',
    );
  }
  return new FlagOpsError(
    'flagsmith_validation',
    `Flagsmith rejected ${describe(label)}${said || ` with HTTP ${status}`}.`,
    { details: { status, messages } },
  );
}

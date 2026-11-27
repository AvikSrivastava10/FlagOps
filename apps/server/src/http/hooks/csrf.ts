import { FlagOpsError } from '@flagops/shared';
import type { FastifyRequest } from 'fastify';
import { isApiPath, pathOf } from '../request-path.js';

/** The header the web app sends with every request that changes something. */
const csrfHeader = 'x-flagops-request';

function originHostname(origin: string): string | undefined {
  return URL.canParse(origin) ? new URL(origin).hostname.toLowerCase() : undefined;
}

/**
 * Cross-site request forgery defence for the API (architecture.md 15, 19). Every API request
 * other than GET and HEAD needs `X-FlagOps-Request: 1`, which a cross-site form or a simple
 * cross-origin request cannot set, and, when it carries an `Origin` header, an origin whose host
 * is allowed. The session cookie is also `SameSite=Strict`.
 */
export function createCsrfCheck(allowedHosts: readonly string[]) {
  const allowed = new Set(allowedHosts);
  return async function checkCsrf(request: FastifyRequest): Promise<void> {
    if (request.method === 'GET' || request.method === 'HEAD' || !isApiPath(pathOf(request.url))) {
      return;
    }
    if (request.headers[csrfHeader] !== '1') {
      throw new FlagOpsError(
        'csrf_rejected',
        'FlagOps refused this request: requests that change something must send the header X-FlagOps-Request: 1.',
      );
    }
    const origin = request.headers.origin;
    if (origin !== undefined) {
      const hostname = originHostname(origin);
      if (hostname === undefined || !allowed.has(hostname)) {
        throw new FlagOpsError(
          'csrf_rejected',
          'FlagOps refused this request because it came from a page on another site.',
        );
      }
    }
  };
}

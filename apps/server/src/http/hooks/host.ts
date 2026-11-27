import { FlagOpsError } from '@flagops/shared';
import type { FastifyRequest } from 'fastify';

/**
 * The hostname of a Host header value, lower-cased and without the port. IPv6 addresses keep their
 * brackets, as browsers send them. Returns undefined for an empty or malformed value.
 */
export function hostnameOf(host: string): string | undefined {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? undefined : value.slice(0, end + 1);
  }
  const hostname = value.split(':', 1)[0];
  return hostname === '' ? undefined : hostname;
}

/**
 * Rejects requests whose Host is not in FLAGOPS_ALLOWED_HOSTS, a defence against DNS rebinding
 * (architecture.md 19). Only the hostname is compared, so any port passes.
 */
export function createHostCheck(allowedHosts: readonly string[]) {
  const allowed = new Set(allowedHosts);
  return async function checkHost(request: FastifyRequest): Promise<void> {
    const hostname = hostnameOf(request.host);
    if (hostname === undefined || !allowed.has(hostname)) {
      throw new FlagOpsError(
        'host_not_allowed',
        'FlagOps does not answer requests for this host. Add the hostname to FLAGOPS_ALLOWED_HOSTS to reach FlagOps through it.',
      );
    }
  };
}

import type { FastifyRequest } from 'fastify';

export type User = { id: string; role: string; plan: string };

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The user behind a request. The shop's gateway signs users in and passes them on in these
 * headers; a request without them comes from an anonymous customer on the free plan.
 */
export function currentUser(request: FastifyRequest): User {
  return {
    id: header(request, 'x-user-id') ?? 'anonymous',
    role: header(request, 'x-user-role') ?? 'customer',
    plan: header(request, 'x-user-plan') ?? 'free',
  };
}

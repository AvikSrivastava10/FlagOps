import type { FastifyReply, FastifyRequest } from 'fastify';

/** Sent with every response (architecture.md 19). The production build has no inline scripts or styles. */
const securityHeaders = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

export async function addSecurityHeaders(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  reply.headers(securityHeaders);
  return payload;
}

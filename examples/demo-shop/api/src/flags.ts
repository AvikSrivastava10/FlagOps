import { Flagsmith, type Flags } from '@flagsmith/nodejs';
import type { FastifyInstance } from 'fastify';
import { currentUser } from './user.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The flags Flagsmith serves to this request's user. */
    flags: Flags;
  }
}

/**
 * Remote evaluation: Flagsmith evaluates every request's flags, so a change in Flagsmith applies
 * to the next request. Use the environment's server-side key.
 */
export const flagsmith = new Flagsmith({
  environmentKey: process.env.FLAGSMITH_ENVIRONMENT_KEY,
  apiUrl: process.env.FLAGSMITH_API_URL ?? 'http://localhost:8000/api/v1/',
});

/** Fetches the user's flags before each route runs; route handlers read `request.flags`. */
export function registerFlags(app: FastifyInstance): void {
  // Fastify wants request properties declared before requests arrive, so that every request
  // object has the same shape.
  app.decorateRequest('flags');
  app.addHook('onRequest', async (request) => {
    const user = currentUser(request);
    const traits = { role: user.role, plan: user.plan };
    // Transient: Flagsmith stores nothing for the request. An existing identity is evaluated with
    // its overrides and stored traits, these traits count for this evaluation only, and an
    // anonymous or unknown user never becomes an identity.
    request.flags = await flagsmith.getIdentityFlags(user.id, traits, true);
  });
}

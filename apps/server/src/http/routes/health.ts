import { healthResponseSchema } from '@flagops/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** Liveness for the Docker HEALTHCHECK; it needs neither a session nor Flagsmith. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/health',
    { config: { public: true }, schema: { response: { 200: healthResponseSchema } } },
    () => ({ status: 'ok' as const }),
  );
};

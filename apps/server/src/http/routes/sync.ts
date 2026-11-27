import { syncResponseSchema } from '@flagops/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** `POST /api/sync`: "Sync now" (features.md S1.1). The sync runs in the background. */
export function syncRoutes(triggerSync: () => 'started' | 'queued'): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/api/sync',
      { schema: { response: { 202: syncResponseSchema } } },
      async (_request, reply) => reply.status(202).send({ status: triggerSync() }),
    );
  };
}

import { scanRequestSchema, scanResponseSchema } from '@flagops/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** Starts the scan job now, or queues it behind a running one; refuses untracked repositories. */
export type ScanTrigger = (repository: string | undefined) => 'started' | 'queued';

/** `POST /api/scans`: "Scan now" (architecture.md 8.5, 15). */
export function scanRoutes(triggerScan: ScanTrigger): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/api/scans',
      // A request without a body scans every tracked repository; Fastify passes it as null.
      { schema: { body: scanRequestSchema.nullish(), response: { 202: scanResponseSchema } } },
      async (request, reply) =>
        reply.status(202).send({ status: triggerScan(request.body?.repository) }),
    );
  };
}

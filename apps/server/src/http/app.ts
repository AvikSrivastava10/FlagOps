import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RawServerDefault,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { handleError } from './errors.js';
import { createHostCheck } from './hooks/host.js';
import { addSecurityHeaders } from './hooks/security-headers.js';
import { pathOf } from './request-path.js';
import { healthRoutes } from './routes/health.js';
import { registerWebApp } from './static.js';

/** The Fastify instance FlagOps runs: pino logger, zod schemas for every route. */
export type App = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  Logger,
  ZodTypeProvider
>;

export type AppOptions = {
  logger: Logger;
  allowedHosts: readonly string[];
  trustProxy: boolean;
  /** Directory of the built web app. Without it, the server answers only the API. */
  webRoot: string | undefined;
};

async function logRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  request.log.debug(
    {
      method: request.method,
      path: pathOf(request.url),
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    },
    'request completed',
  );
}

/** Builds the Fastify app: hooks first, so they cover every route, then routes and the web app. */
export async function buildApp(options: AppOptions): Promise<App> {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy: options.trustProxy,
    genReqId: () => randomUUID(),
    // Fastify's own request log lines include the query string, which can carry identity
    // identifiers; logRequest logs the path only (architecture.md 18.3).
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  app.addHook('onRequest', createHostCheck(options.allowedHosts));
  app.addHook('onSend', addSecurityHeaders);
  app.addHook('onResponse', logRequest);

  await app.register(healthRoutes);
  await registerWebApp(app, options.webRoot);
  return app;
}

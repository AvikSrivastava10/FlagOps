import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import { FlagOpsError } from '@flagops/shared';
import Fastify, {
  LogController,
  type FastifyError,
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
import type { AuthService } from '../auth/login.js';
import type { SessionStore } from '../auth/sessions.js';
import { handleError } from './errors.js';
import { createCsrfCheck } from './hooks/csrf.js';
import { createHostCheck } from './hooks/host.js';
import { addSecurityHeaders } from './hooks/security-headers.js';
import { clearSessionCookie, createSessionHook } from './hooks/session.js';
import { pathOf } from './request-path.js';
import { healthRoutes } from './routes/health.js';
import { ownerMappingRoutes, type OwnerMappingService } from './routes/owner-mappings.js';
import { scanRoutes, type ScanTrigger } from './routes/scans.js';
import { sessionRoutes } from './routes/session.js';
import { syncRoutes } from './routes/sync.js';
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
  /** The in-memory store in the product; tests pass one with prepared sessions. */
  sessions: SessionStore;
  auth: AuthService;
  /** Starts a sync now, or queues one behind the running sync. */
  triggerSync: () => 'started' | 'queued';
  /** Starts the scan job now, or queues it; refuses an untracked repository. */
  triggerScan: ScanTrigger;
  ownerMappings: OwnerMappingService;
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
  // When Flagsmith rejects the operator's credential, the FlagOps session ends with it
  // (architecture.md 14.2).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (
      error instanceof FlagOpsError &&
      error.code === 'flagsmith_session_expired' &&
      request.session !== null
    ) {
      options.sessions.destroy(request.session.id);
      clearSessionCookie(reply);
    }
    return handleError(error, request, reply);
  });
  await app.register(fastifyCookie);
  app.decorateRequest('session', null);
  app.addHook('onRequest', createHostCheck(options.allowedHosts));
  app.addHook('onRequest', createCsrfCheck(options.allowedHosts));
  app.addHook('onRequest', createSessionHook(options.sessions));
  app.addHook('onSend', addSecurityHeaders);
  app.addHook('onResponse', logRequest);

  await app.register(healthRoutes);
  await app.register(sessionRoutes(options.auth));
  await app.register(syncRoutes(options.triggerSync));
  await app.register(scanRoutes(options.triggerScan));
  await app.register(ownerMappingRoutes(options.ownerMappings));
  await registerWebApp(app, options.webRoot);
  return app;
}

import {
  mfaChallengeResponseSchema,
  mfaRequestSchema,
  sessionResponseSchema,
  signInRequestSchema,
} from '@flagops/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthService } from '../../auth/login.js';
import type { Session } from '../../auth/sessions.js';
import { clearSessionCookie, sessionOf, setSessionCookie } from '../hooks/session.js';

function userOf(session: Session) {
  return { user: session.user };
}

/**
 * Sign-in, the MFA step, the current session and sign-out (architecture.md 14, 15). Request
 * bodies are never logged, so the password and the MFA code cannot reach the log.
 */
export function sessionRoutes(auth: AuthService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/api/session',
      {
        config: { public: true },
        schema: {
          body: signInRequestSchema,
          response: { 200: sessionResponseSchema, 202: mfaChallengeResponseSchema },
        },
      },
      async (request, reply) => {
        const outcome = await auth.signIn(request.body, request.ip);
        if (outcome.kind === 'mfa_required') {
          return reply.status(202).send({ mfaRequired: true, challengeId: outcome.challengeId });
        }
        setSessionCookie(request, reply, outcome.session);
        return reply.status(200).send(userOf(outcome.session));
      },
    );

    app.post(
      '/api/session/mfa',
      {
        config: { public: true },
        schema: { body: mfaRequestSchema, response: { 200: sessionResponseSchema } },
      },
      async (request, reply) => {
        const session = await auth.completeMfa(request.body, request.ip);
        setSessionCookie(request, reply, session);
        return userOf(session);
      },
    );

    app.get('/api/session', { schema: { response: { 200: sessionResponseSchema } } }, (request) =>
      userOf(sessionOf(request)),
    );

    app.delete('/api/session', async (request, reply) => {
      auth.signOut(sessionOf(request));
      clearSessionCookie(reply);
      return reply.status(204).send();
    });
  };
}

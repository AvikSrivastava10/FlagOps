import { FlagOpsError } from '@flagops/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Session, SessionStore } from '../../auth/sessions.js';
import { isApiPath } from '../request-path.js';

const sessionCookieName = 'flagops_session';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Marks one of the three API routes that work without a session (architecture.md 15). */
    public?: boolean;
  }
  interface FastifyRequest {
    /** The signed-in operator's session; the session hook sets it on every protected route. */
    session: Session | null;
  }
}

/** Sets the session cookie: HttpOnly, SameSite=Strict, and Secure when the request is HTTPS. */
export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  session: Session,
): void {
  reply.setCookie(sessionCookieName, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: request.protocol === 'https',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: '/' });
}

/**
 * The one gate in front of the API (architecture.md 20): every API route needs a live session
 * unless it is marked public. The decision follows the route that matched, not the request path:
 * an unknown `/api` path matches no route, or the web app's catch-all route, and gets `not_found`.
 * The web app's files are served to anyone, because they hold no data.
 */
export function createSessionHook(sessions: SessionStore) {
  return async function requireSession(request: FastifyRequest): Promise<void> {
    const route = request.routeOptions.url;
    if (route === undefined || !isApiPath(route) || request.routeOptions.config.public === true) {
      return;
    }
    const id = request.cookies[sessionCookieName];
    const session = id === undefined ? undefined : sessions.get(id);
    if (session === undefined) {
      throw new FlagOpsError('auth_required', 'Sign in to FlagOps to continue.');
    }
    request.session = session;
  };
}

/** The session of a protected route; the session hook guarantees it. */
export function sessionOf(request: FastifyRequest): Session {
  if (request.session === null) {
    throw new Error('A protected route ran without a session');
  }
  return request.session;
}

import { randomBytes } from 'node:crypto';
import type { SessionUser } from '@flagops/shared';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';

export type Session = {
  id: string;
  user: SessionUser;
  /** The operator's Flagsmith credential. It is held only here, in memory, never on disk. */
  credential: FlagsmithCredential;
  createdAt: number;
  lastSeenAt: number;
};

/**
 * Where sessions live. The product uses the in-memory store that sign-in fills; tests pass a store
 * with prepared sessions. No route or setting creates a session any other way (architecture.md 14.2).
 */
export type SessionStore = {
  create(input: { user: SessionUser; credential: FlagsmithCredential }): Session;
  /** The session, if it exists and has not expired; reading it counts as activity. */
  get(id: string): Session | undefined;
  destroy(id: string): void;
};

export const sessionIdleMs = 8 * 60 * 60 * 1000;
export const sessionLifetimeMs = 24 * 60 * 60 * 1000;

/**
 * Sessions in memory, keyed by 32 random bytes. A session ends after 8 idle hours, after 24 hours
 * in all, or when the process restarts.
 */
export function createMemorySessionStore(now: () => number = Date.now): SessionStore {
  const sessions = new Map<string, Session>();
  return {
    create({ user, credential }) {
      const time = now();
      const session = {
        id: randomBytes(32).toString('base64url'),
        user,
        credential,
        createdAt: time,
        lastSeenAt: time,
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      const session = sessions.get(id);
      if (session === undefined) {
        return undefined;
      }
      const time = now();
      if (
        time - session.lastSeenAt > sessionIdleMs ||
        time - session.createdAt > sessionLifetimeMs
      ) {
        sessions.delete(id);
        return undefined;
      }
      session.lastSeenAt = time;
      return session;
    },
    destroy(id) {
      sessions.delete(id);
    },
  };
}

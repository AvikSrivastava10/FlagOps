import { FlagOpsError, type MfaRequest, type SignInRequest } from '@flagops/shared';
import type { Logger } from 'pino';
import { appendAudit } from '../audit/audit.js';
import type { Db } from '../db/connection.js';
import { currentUser, login, loginWithMfaCode } from '../flagsmith/auth-api.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import { listOrganisations, type Organisation } from '../flagsmith/projects.js';
import type { AttemptLimiter } from './attempt-limiter.js';
import type { MfaChallenges } from './mfa.js';
import type { Session, SessionStore } from './sessions.js';

export type SignInOutcome =
  { kind: 'signed_in'; session: Session } | { kind: 'mfa_required'; challengeId: string };

export type AuthService = {
  signIn(input: SignInRequest, clientIp: string): Promise<SignInOutcome>;
  completeMfa(input: MfaRequest, clientIp: string): Promise<Session>;
  signOut(session: Session): void;
};

export type AuthServiceDeps = {
  client: FlagsmithClient;
  keyOrganisation: () => Promise<Organisation>;
  sessions: SessionStore;
  challenges: MfaChallenges;
  limiter: AttemptLimiter;
  db: Db;
  logger: Logger;
};

function checkAttempt(limiter: AttemptLimiter, clientIp: string): void {
  const result = limiter.attempt(clientIp);
  if (!result.allowed) {
    throw new FlagOpsError(
      'auth_rate_limited',
      `Too many sign-in attempts from this address. Try again in ${result.retryAfterSeconds} seconds.`,
      { details: { retryAfter: result.retryAfterSeconds } },
    );
  }
}

/** Flagsmith's own throttle on sign-in (20 a minute, 5 for MFA codes), as `auth_rate_limited`. */
function throttled(error: FlagOpsError): FlagOpsError {
  const retryAfter = typeof error.details?.retryAfter === 'number' ? error.details.retryAfter : 60;
  return new FlagOpsError(
    'auth_rate_limited',
    `Flagsmith is limiting sign-in attempts. Try again in ${retryAfter} seconds.`,
    { details: { retryAfter }, cause: error },
  );
}

function displayName(user: { email: string; first_name: string | null; last_name: string | null }) {
  const name = [user.first_name, user.last_name]
    .filter((part) => part !== null && part !== '')
    .join(' ');
  return name.trim() === '' ? user.email : name.trim();
}

/**
 * Sign-in with the operator's Flagsmith account (architecture.md 14, D-007). FlagOps forwards the
 * email and password once, completes Flagsmith's MFA step when asked, and admits only admins of
 * the organisation that owns the API key. The resulting Flagsmith credential stays in the
 * in-memory session; nothing about the sign-in is logged except the user ID.
 */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  async function establish(credential: FlagsmithCredential): Promise<Session> {
    const organisation = await deps.keyOrganisation();
    const user = await currentUser(deps.client, credential);
    const memberships = await listOrganisations(deps.client, credential);
    const membership = memberships.find((item) => item.id === organisation.id);
    if (membership?.role !== 'ADMIN') {
      deps.logger.info({ userId: user.id }, 'Sign-in refused: not an organisation admin');
      throw new FlagOpsError(
        'auth_not_org_admin',
        `This Flagsmith account is not an admin of ${organisation.name}.`,
      );
    }
    const session = deps.sessions.create({
      user: { id: user.id, email: user.email, displayName: displayName(user) },
      credential,
    });
    appendAudit(deps.db, {
      actor: { kind: 'user', userId: user.id, email: user.email },
      action: 'sign_in',
      outcome: 'succeeded',
    });
    deps.logger.info({ userId: user.id }, 'Signed in');
    return session;
  }

  return {
    async signIn(input, clientIp) {
      checkAttempt(deps.limiter, clientIp);
      // Resolving the organisation first turns a Flagsmith outage into flagsmith_unreachable.
      await deps.keyOrganisation();
      let result;
      try {
        result = await login(deps.client, input);
      } catch (error) {
        if (!(error instanceof FlagOpsError)) {
          throw error;
        }
        if (error.code === 'flagsmith_validation') {
          deps.logger.info('Sign-in refused: Flagsmith did not accept the credentials');
          throw new FlagOpsError(
            'auth_invalid_credentials',
            'Flagsmith did not accept this email and password.',
          );
        }
        if (error.code === 'flagsmith_forbidden') {
          throw new FlagOpsError(
            'auth_login_not_allowed',
            'This Flagsmith instance does not allow signing in with an email and password.',
          );
        }
        throw error.code === 'flagsmith_rate_limited' ? throttled(error) : error;
      }
      if (result.kind === 'mfa_required') {
        return {
          kind: 'mfa_required',
          challengeId: deps.challenges.create(result.ephemeralToken).id,
        };
      }
      return { kind: 'signed_in', session: await establish(result.credential) };
    },

    async completeMfa(input, clientIp) {
      checkAttempt(deps.limiter, clientIp);
      const challenge = deps.challenges.get(input.challengeId);
      if (challenge === undefined) {
        throw new FlagOpsError(
          'auth_mfa_invalid',
          'This sign-in has expired or had too many wrong codes. Sign in again.',
        );
      }
      let credential;
      try {
        credential = await loginWithMfaCode(deps.client, {
          code: input.code,
          ephemeralToken: challenge.ephemeralToken,
        });
      } catch (error) {
        if (!(error instanceof FlagOpsError)) {
          throw error;
        }
        if (error.code === 'flagsmith_session_expired' || error.code === 'flagsmith_validation') {
          deps.challenges.recordFailure(challenge.id);
          throw new FlagOpsError(
            'auth_mfa_invalid',
            'Flagsmith did not accept this code. Check your authenticator app and try again.',
          );
        }
        throw error.code === 'flagsmith_rate_limited' ? throttled(error) : error;
      }
      deps.challenges.close(challenge.id);
      return establish(credential);
    },

    signOut(session) {
      deps.sessions.destroy(session.id);
      appendAudit(deps.db, {
        actor: { kind: 'user', userId: session.user.id, email: session.user.email },
        action: 'sign_out',
        outcome: 'succeeded',
      });
      deps.logger.info({ userId: session.user.id }, 'Signed out');
    },
  };
}

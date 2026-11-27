import { randomBytes } from 'node:crypto';
import type { Secret } from '../config/secret.js';

export type MfaChallenge = {
  id: string;
  /** Flagsmith's ephemeral token for the second step; it never leaves the server. */
  ephemeralToken: Secret;
  attemptsLeft: number;
  expiresAt: number;
};

export type MfaChallenges = {
  create(ephemeralToken: Secret): MfaChallenge;
  /** The open challenge, or undefined when it is unknown, expired or out of attempts. */
  get(id: string): MfaChallenge | undefined;
  /** Counts a wrong code; the challenge closes after the fifth. */
  recordFailure(id: string): void;
  close(id: string): void;
};

export const mfaChallengeLifetimeMs = 5 * 60 * 1000;
const mfaAttempts = 5;

/** Challenges in memory: 5 minutes and 5 attempts each (architecture.md 14.2). */
export function createMfaChallenges(now: () => number = Date.now): MfaChallenges {
  const challenges = new Map<string, MfaChallenge>();
  return {
    create(ephemeralToken) {
      const challenge = {
        id: randomBytes(32).toString('base64url'),
        ephemeralToken,
        attemptsLeft: mfaAttempts,
        expiresAt: now() + mfaChallengeLifetimeMs,
      };
      challenges.set(challenge.id, challenge);
      return challenge;
    },
    get(id) {
      const challenge = challenges.get(id);
      if (challenge === undefined) {
        return undefined;
      }
      if (now() > challenge.expiresAt || challenge.attemptsLeft <= 0) {
        challenges.delete(id);
        return undefined;
      }
      return challenge;
    },
    recordFailure(id) {
      const challenge = challenges.get(id);
      if (challenge !== undefined) {
        challenge.attemptsLeft -= 1;
      }
    },
    close(id) {
      challenges.delete(id);
    },
  };
}

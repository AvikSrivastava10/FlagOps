import { z } from 'zod';

/**
 * Sign-in with the operator's Flagsmith account (architecture.md 14). The password travels once,
 * to Flagsmith, and is never stored or logged.
 */
export const signInRequestSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

export type SignInRequest = z.infer<typeof signInRequestSchema>;

/** The second step when the Flagsmith account uses two-factor authentication. */
export const mfaRequestSchema = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().trim().min(1).max(20),
});

export type MfaRequest = z.infer<typeof mfaRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  displayName: z.string(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

/** `POST /api/session` and `POST /api/session/mfa` (200), and `GET /api/session`. */
export const sessionResponseSchema = z.object({ user: sessionUserSchema });

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** `POST /api/session` (202) when Flagsmith asks for a two-factor code. */
export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeId: z.string(),
});

export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

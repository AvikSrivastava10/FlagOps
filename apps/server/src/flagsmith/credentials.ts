import type { Secret } from '../config/secret.js';

/**
 * The credentials FlagOps sends to Flagsmith (architecture.md 6.2, D-008):
 * - the organisation API key, for background work and the seed;
 * - the operator's session, a DRF token or, on instances with `COOKIE_AUTH_ENABLED`, a JWT cookie.
 *   Writes the operator starts use it, so Flagsmith applies its permissions and attributes them.
 * - an environment's client key, which is public by design; only the seed's trait upload uses it.
 */
export type FlagsmithCredential =
  | { kind: 'organisation_key'; key: Secret }
  | { kind: 'user_token'; token: Secret }
  | { kind: 'user_jwt'; jwt: Secret }
  | { kind: 'environment_key'; key: string };

/** The request headers that carry a credential. They are never logged (architecture.md 18.3). */
export function authHeaders(credential: FlagsmithCredential): Record<string, string> {
  switch (credential.kind) {
    case 'organisation_key':
      return { authorization: `Api-Key ${credential.key.reveal()}` };
    case 'user_token':
      return { authorization: `Token ${credential.token.reveal()}` };
    case 'user_jwt':
      return { cookie: `jwt=${credential.jwt.reveal()}` };
    case 'environment_key':
      return { 'x-environment-key': credential.key };
  }
}

/** Which kind of credential a request carries, read back from the headers `authHeaders` set. */
export type CredentialKind = 'organisation_key' | 'user' | 'environment_key' | 'none';

export function credentialKindOf(headers: Headers): CredentialKind {
  const authorization = headers.get('authorization') ?? '';
  if (authorization.startsWith('Api-Key ')) {
    return 'organisation_key';
  }
  if (authorization.startsWith('Token ') || (headers.get('cookie') ?? '').startsWith('jwt=')) {
    return 'user';
  }
  return headers.has('x-environment-key') ? 'environment_key' : 'none';
}

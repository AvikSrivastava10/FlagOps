import { z } from 'zod';
import { Secret } from '../config/secret.js';
import { parseResponse, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { unexpectedResponse } from './errors.js';

/**
 * Flagsmith's sign-in endpoints (architecture.md 14.1). The email, password and MFA code are sent
 * once and never kept; the credential Flagsmith returns lives only in the FlagOps session.
 */

export type LoginResult =
  | { kind: 'signed_in'; credential: FlagsmithCredential }
  | { kind: 'mfa_required'; ephemeralToken: Secret };

const loginBodySchema = z.union([
  z.object({ key: z.string().min(1) }),
  z.object({ ephemeral_token: z.string().min(1), method: z.string() }),
]);

/**
 * In cookie mode (`COOKIE_AUTH_ENABLED`), Flagsmith answers 204 and sets the `jwt` cookie, which
 * FlagOps then sends as `Cookie: jwt=...` (`api/custom_auth/views.py:46-103`).
 */
function jwtFromCookies(response: Response, path: string, version: string | undefined): Secret {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('jwt='));
  const token = cookie?.slice('jwt='.length).split(';', 1)[0] ?? '';
  if (token === '') {
    throw unexpectedResponse({ method: 'POST', path }, 'no content and no jwt cookie', version);
  }
  return new Secret(token);
}

function credentialFrom(
  client: FlagsmithClient,
  response: Response,
  data: unknown,
  path: string,
): LoginResult {
  if (response.status === 204) {
    return {
      kind: 'signed_in',
      credential: {
        kind: 'user_jwt',
        jwt: jwtFromCookies(response, path, client.observedVersion()),
      },
    };
  }
  const body = parseResponse(client, loginBodySchema, data, { method: 'POST', path });
  return 'key' in body
    ? { kind: 'signed_in', credential: { kind: 'user_token', token: new Secret(body.key) } }
    : { kind: 'mfa_required', ephemeralToken: new Secret(body.ephemeral_token) };
}

/** `POST /api/v1/auth/login/`: a token, a JWT cookie, or an MFA challenge. Flagsmith throttles it at 20 a minute. */
export async function login(
  client: FlagsmithClient,
  input: { email: string; password: string },
): Promise<LoginResult> {
  const path = '/api/v1/auth/login/';
  const { data, response } = await client.api.POST(path, {
    body: { email: input.email, password: input.password },
  });
  return credentialFrom(client, response, data, path);
}

/** `POST /api/v1/auth/login/code/`: the second step, throttled by Flagsmith at 5 a minute. */
export async function loginWithMfaCode(
  client: FlagsmithClient,
  input: { code: string; ephemeralToken: Secret },
): Promise<FlagsmithCredential> {
  const path = '/api/v1/auth/login/code/';
  const { data, response } = await client.api.POST(path, {
    body: { code: input.code, ephemeral_token: input.ephemeralToken.reveal() },
  });
  const result = credentialFrom(client, response, data, path);
  if (result.kind !== 'signed_in') {
    throw unexpectedResponse(
      { method: 'POST', path },
      'a second MFA challenge',
      client.observedVersion(),
    );
  }
  return result.credential;
}

const userSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});

export type FlagsmithUser = z.infer<typeof userSchema>;

/**
 * `GET /api/v1/auth/users/me/`. Called only with a credential: without one, Flagsmith 2.295.2
 * answers 500 (architecture.md 6.5).
 */
export async function currentUser(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
): Promise<FlagsmithUser> {
  const path = '/api/v1/auth/users/me/';
  const { data } = await client.api.GET(path, { headers: authHeaders(credential) });
  return parseResponse(client, userSchema, data, { method: 'GET', path });
}

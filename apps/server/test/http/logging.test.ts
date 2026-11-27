import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildTestApp, writeHeaders } from '../helpers/app.js';
import { captureLogs } from '../helpers/log-capture.js';

const apiKey = 'Api-Key s3cr3t-organisation-key';
const cookie = 'jwt=s3cr3t-session-cookie';
const password = 'pa55word-never-logged';
const flagsmithToken = 's3cr3t-flagsmith-token';

let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('logging', () => {
  it('never writes an Authorization header, a cookie or a password body field', async () => {
    const logs = captureLogs();
    app = await buildTestApp(createLogger('debug', logs.destination));
    // A careless log statement of the request headers and body, then an unexpected failure, so
    // the redaction and the error path both see the secrets.
    app.post('/api/test/sign-in', { config: { public: true } }, (request) => {
      request.log.info({ req: { headers: request.headers }, body: request.body }, 'careless log');
      throw new Error('sign-in failed');
    });

    const request = {
      method: 'POST' as const,
      headers: { ...writeHeaders, authorization: apiKey, cookie },
      payload: { email: 'operator@example.com', password },
    };
    const failed = await app.inject({ ...request, url: '/api/test/sign-in' });
    const missing = await app.inject({ ...request, url: '/api/session?password=x' });

    // The second request reaches the real sign-in route, whose test auth service fails.
    expect(failed.statusCode).toBe(500);
    expect(missing.statusCode).toBe(500);
    const output = logs.text();
    expect(output).toContain('careless log');
    expect(output).toContain('request completed');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('s3cr3t-organisation-key');
    expect(output).not.toContain('s3cr3t-session-cookie');
    expect(output).not.toContain(password);
    expect(output).not.toContain('password=x');
  });

  it('redacts secrets at the top level of a logged object, as in a Flagsmith login response', () => {
    const logs = captureLogs();
    const logger = createLogger('debug', logs.destination);

    logger.debug({ key: flagsmithToken }, 'login response');
    logger.debug({ ephemeral_token: flagsmithToken, method: 'app' }, 'mfa response');
    logger.debug({ password, token: flagsmithToken, apiKey: flagsmithToken }, 'careless log');

    expect(logs.text()).not.toContain(flagsmithToken);
    expect(logs.text()).not.toContain(password);
    expect(logs.entries()[1]).toMatchObject({ method: 'app', ephemeral_token: '[Redacted]' });
  });
});

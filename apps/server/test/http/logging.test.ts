import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { captureLogs } from '../helpers/log-capture.js';

const apiKey = 'Api-Key s3cr3t-organisation-key';
const cookie = 'jwt=s3cr3t-session-cookie';
const password = 'pa55word-never-logged';

let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('logging', () => {
  it('never writes an Authorization header, a cookie or a password body field', async () => {
    const logs = captureLogs();
    app = await buildApp({
      logger: createLogger('debug', logs.destination),
      allowedHosts: ['localhost'],
      trustProxy: false,
      webRoot: undefined,
    });
    // A careless log statement of the request headers and body, then an unexpected failure, so
    // the redaction and the error path both see the secrets.
    app.post('/api/test/sign-in', (request) => {
      request.log.info({ req: { headers: request.headers }, body: request.body }, 'careless log');
      throw new Error('sign-in failed');
    });

    const request = {
      method: 'POST' as const,
      headers: { authorization: apiKey, cookie },
      payload: { email: 'operator@example.com', password },
    };
    const failed = await app.inject({ ...request, url: '/api/test/sign-in' });
    const missing = await app.inject({ ...request, url: '/api/session?password=x' });

    expect(failed.statusCode).toBe(500);
    expect(missing.statusCode).toBe(404);
    const output = logs.text();
    expect(output).toContain('careless log');
    expect(output).toContain('request completed');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('s3cr3t-organisation-key');
    expect(output).not.toContain('s3cr3t-session-cookie');
    expect(output).not.toContain(password);
    expect(output).not.toContain('password=x');
  });
});

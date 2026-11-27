import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { App } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildTestApp, writeHeaders } from '../helpers/app.js';
import { captureLogs } from '../helpers/log-capture.js';

const expectedSecurityHeaders = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

let webRoot: string;

beforeAll(() => {
  webRoot = mkdtempSync(path.join(tmpdir(), 'flagops-web-'));
  mkdirSync(path.join(webRoot, 'assets'));
  writeFileSync(
    path.join(webRoot, 'index.html'),
    '<!doctype html><title>FlagOps test shell</title>',
  );
  writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'export {};');
});

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

let app: App | undefined;
let logs = captureLogs();

async function makeApp(options: { webRoot?: string } = {}): Promise<App> {
  logs = captureLogs();
  app = await buildTestApp(createLogger('info', logs.destination), { webRoot: options.webRoot });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('answers ok', async () => {
    const response = await (await makeApp()).inject('/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('host check', () => {
  it('refuses a Host that is not allowed, with host_not_allowed', async () => {
    const response = await (
      await makeApp({ webRoot })
    ).inject({ url: '/api/health', headers: { host: 'evil.example' } });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'host_not_allowed' } });
  });

  it('protects the web app too', async () => {
    const response = await (
      await makeApp({ webRoot })
    ).inject({ url: '/', headers: { host: 'evil.example:3000' } });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'host_not_allowed' } });
  });

  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST'])(
    'accepts %s, comparing the hostname only',
    async (host) => {
      const response = await (await makeApp()).inject({ url: '/api/health', headers: { host } });

      expect(response.statusCode).toBe(200);
    },
  );
});

describe('security headers', () => {
  it.each([
    ['the API', '/api/health', {}],
    ['the web app', '/', {}],
    ['an API 404', '/api/missing', {}],
    ['a refused host', '/api/health', { host: 'evil.example' }],
  ])('are sent with %s', async (_what, url, headers) => {
    const response = await (await makeApp({ webRoot })).inject({ url, headers });

    expect(response.headers).toMatchObject(expectedSecurityHeaders);
  });
});

describe('web app', () => {
  it('serves index.html at /', async () => {
    const response = await (await makeApp({ webRoot })).inject('/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toContain('FlagOps test shell');
  });

  it('serves built assets', async () => {
    const response = await (await makeApp({ webRoot })).inject('/assets/app.js');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
  });

  it.each(['GET', 'HEAD'] as const)(
    'falls back to index.html for a %s of an app route',
    async (method) => {
      const response = await (
        await makeApp({ webRoot })
      ).inject({ method, url: '/flags/12?tab=history' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
    },
  );

  it('answers an unknown API route with JSON not_found, never the web app', async () => {
    const response = await (await makeApp({ webRoot })).inject('/api/missing?q=x');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'No API route matches GET /api/missing' },
    });
  });

  it('answers other methods outside the API with not_found', async () => {
    const response = await (
      await makeApp({ webRoot })
    ).inject({ method: 'POST', url: '/flags/12' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers not_found for app routes when no web app is built', async () => {
    const response = await (await makeApp()).inject('/');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Nothing is served at GET /' },
    });
  });
});

describe('error mapping', () => {
  async function appWithTestRoutes(): Promise<App> {
    const testApp = await makeApp();
    const config = { public: true };
    testApp.get('/api/test/expected', { config }, () => {
      throw new FlagOpsError('retire_not_eligible', 'new_checkout is still rolling out', {
        details: { stage: 'rolling_out' },
      });
    });
    testApp.get('/api/test/unexpected', { config }, () => {
      throw new Error('database exploded');
    });
    testApp.post(
      '/api/test/validated',
      { config, schema: { body: z.object({ name: z.string() }) } },
      (request) => ({ name: request.body.name }),
    );
    return testApp;
  }

  it('sends a FlagOpsError with the status of its code, its message and details', async () => {
    const response = await (await appWithTestRoutes()).inject('/api/test/expected');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'retire_not_eligible',
        message: 'new_checkout is still rolling out',
        details: { stage: 'rolling_out' },
      },
    });
  });

  it('hides an unexpected error behind internal_error with a request ID, and logs it', async () => {
    const response = await (await appWithTestRoutes()).inject('/api/test/unexpected');
    const body = response.json<{ error: { message: string; details: { requestId: string } } }>();

    expect(response.statusCode).toBe(500);
    expect(body.error).toMatchObject({ code: 'internal_error' });
    expect(body.error.message).not.toContain('database exploded');
    expect(body.error.details.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.error.message).toContain(body.error.details.requestId);
    expect(logs.entries()).toContainEqual(
      expect.objectContaining({
        level: 50,
        reqId: body.error.details.requestId,
        err: expect.objectContaining({ message: 'database exploded' }) as unknown,
      }),
    );
  });

  it('answers an invalid body with validation_failed and the zod issues', async () => {
    const response = await (
      await appWithTestRoutes()
    ).inject({
      method: 'POST',
      url: '/api/test/validated',
      headers: writeHeaders,
      payload: { name: 42 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'validation_failed',
        details: {
          issues: [{ location: 'body', path: '/name', message: expect.any(String) as unknown }],
        },
      },
    });
  });

  it.each([
    ['malformed JSON', '{"name":', 'application/json'],
    ['a body over 1 MB', JSON.stringify({ name: 'x'.repeat(1_048_577) }), 'application/json'],
    ['an unsupported media type', 'name=x', 'application/x-www-form-urlencoded'],
  ])('answers %s with validation_failed', async (_what, payload, contentType) => {
    const response = await (
      await appWithTestRoutes()
    ).inject({
      method: 'POST',
      url: '/api/test/validated',
      headers: { ...writeHeaders, 'content-type': contentType },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

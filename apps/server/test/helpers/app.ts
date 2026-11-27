import type { Logger } from 'pino';
import type { AuthService } from '../../src/auth/login.js';
import { createMemorySessionStore } from '../../src/auth/sessions.js';
import { buildApp, type App, type AppOptions } from '../../src/http/app.js';
import type { OwnerMappingService } from '../../src/http/routes/owner-mappings.js';

/** An auth service for route tests that never sign in. */
const noSignIn: AuthService = {
  signIn: () => Promise.reject(new Error('this test does not sign in')),
  completeMfa: () => Promise.reject(new Error('this test does not sign in')),
  signOut: () => undefined,
};

/** An ownership service for route tests that do not map owners. */
const noOwnerMappings: OwnerMappingService = {
  directory: () => Promise.reject(new Error('this test does not read the directory')),
  save: () => Promise.reject(new Error('this test does not map owners')),
};

/**
 * Builds the app with test defaults: no web app, an empty session store and no real auth. Tests
 * that need sessions pass their own store and auth service; the product creates sessions only
 * through sign-in (architecture.md 14.2).
 */
export async function buildTestApp(
  logger: Logger,
  overrides: Partial<AppOptions> = {},
): Promise<App> {
  return buildApp({
    logger,
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    trustProxy: false,
    webRoot: undefined,
    sessions: createMemorySessionStore(),
    auth: noSignIn,
    triggerSync: () => 'started',
    triggerScan: () => 'started',
    ownerMappings: noOwnerMappings,
    ...overrides,
  });
}

/** The header every API request that changes something must carry (architecture.md 15). */
export const writeHeaders = { 'x-flagops-request': '1' };

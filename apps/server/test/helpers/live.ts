import { Secret } from '../../src/config/secret.js';
import { createFlagsmithClient, type FlagsmithClient } from '../../src/flagsmith/client.js';
import type { FlagsmithCredential } from '../../src/flagsmith/credentials.js';
import { createLogger } from '../../src/logger.js';
import { captureLogs } from './log-capture.js';

/**
 * Live suites run against the demo organisation with the `.env` that vitest.live.config.ts loads.
 * They touch nothing else: the organisation key can reach only its own organisation.
 */
function missingVariables(...names: string[]): string[] {
  return names.filter((name) => (process.env[name] ?? '').trim() === '');
}

/** Why a suite cannot run, naming the variables, or undefined when it can. */
export function skipReason(...names: string[]): string | undefined {
  const missing = missingVariables(...names);
  return missing.length === 0
    ? undefined
    : `set ${missing.join(' and ')} in .env to run this suite`;
}

export function liveFlagsmithUrl(): string {
  return (process.env.FLAGSMITH_INTERNAL_URL ?? process.env.FLAGSMITH_URL ?? '').replace(
    /\/+$/,
    '',
  );
}

export function liveOrganisationKey(): FlagsmithCredential {
  return { kind: 'organisation_key', key: new Secret(process.env.FLAGSMITH_ORG_API_KEY ?? '') };
}

export function liveClient(): FlagsmithClient {
  return createFlagsmithClient({
    baseUrl: liveFlagsmithUrl(),
    logger: createLogger('error', captureLogs().destination),
  });
}

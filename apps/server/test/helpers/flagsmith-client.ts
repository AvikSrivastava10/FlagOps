import { Secret } from '../../src/config/secret.js';
import { createFlagsmithClient, type FlagsmithClient } from '../../src/flagsmith/client.js';
import type { FlagsmithCredential } from '../../src/flagsmith/credentials.js';
import { createLogger } from '../../src/logger.js';
import { createFakeFlagsmith, fakeOrganisationKey, type FakeFlagsmith } from './fake-flagsmith.js';
import { captureLogs } from './log-capture.js';

export const organisationKey: FlagsmithCredential = {
  kind: 'organisation_key',
  key: new Secret(fakeOrganisationKey),
};

/** The real Flagsmith client, talking to an in-memory fake Flagsmith. */
export function fakeClient(fake: FakeFlagsmith = createFakeFlagsmith()): {
  fake: FakeFlagsmith;
  client: FlagsmithClient;
} {
  return {
    fake,
    client: createFlagsmithClient({
      baseUrl: 'http://flagsmith.test',
      logger: createLogger('error', captureLogs().destination),
      fetch: fake.fetch,
      readRetryDelaysMs: [1, 1],
    }),
  };
}

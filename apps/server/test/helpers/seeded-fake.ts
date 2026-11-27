import { runSeed, type SeedReport } from '../../src/cli/seed-runner.js';
import type { FlagsmithClient } from '../../src/flagsmith/client.js';
import type { TypeTagIds } from '../../src/flagsmith/tags.js';
import { createLogger } from '../../src/logger.js';
import type { FakeFlagsmith } from './fake-flagsmith.js';
import { fakeClient, organisationKey } from './flagsmith-client.js';
import { captureLogs } from './log-capture.js';

/** Runs the real seed against a fake Flagsmith; the type-tag IDs live in memory between runs. */
export function seeder(fake?: FakeFlagsmith) {
  const { fake: flagsmith, client } = fakeClient(fake);
  let typeTagIds: TypeTagIds = {};
  return {
    fake: flagsmith,
    client: client satisfies FlagsmithClient,
    seed: (): Promise<SeedReport> =>
      runSeed({
        client,
        credential: organisationKey,
        typeTagIds: {
          load: () => typeTagIds,
          save: (ids) => {
            typeTagIds = ids;
          },
        },
        logger: createLogger('error', captureLogs().destination),
        pollIntervalMs: 1,
      }),
  };
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EnvironmentDocument } from '../src/flagsmith/document.js';
import type { FlagApiConfig } from '../src/flagsmith/flag-api.js';
import { fromEnvironmentDocument, fromFlagApi } from '../src/flagsmith/mappers/flag-config.js';

/**
 * The mapper contract (plan S3.5) on responses recorded from the seeded Flagsmith 2.295.2 and
 * scrubbed: both mappers give the same configuration for every seeded flag and environment.
 */
const fixtures = new URL('./fixtures/flagsmith/seeded/', import.meta.url);

function read(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as unknown;
}

const segments = z
  .object({ results: z.array(z.object({ id: z.number(), managed_by: z.string() })) })
  .parse(read('segments.json')).results;

const featureList = z.object({
  results: z.array(
    z.object({ id: z.number(), name: z.string(), num_identity_overrides: z.number().nullable() }),
  ),
});

const environments = ['development', 'staging', 'production'].map((name) => ({
  name,
  document: read(`${name}/document.json`) as EnvironmentDocument,
  features: featureList.parse(read(`${name}/features.json`)).results,
  flags: read(`${name}/flags.json`) as Record<string, FlagApiConfig>,
}));

describe('the two Flagsmith mappers', () => {
  const cases = environments.flatMap((environment) =>
    environment.features.map((feature) => ({ environment, feature })),
  );

  it('covers the ten seeded flags in three environments', () => {
    expect(cases).toHaveLength(30);
  });

  it.each(cases.map((item) => [item.environment.name, item.feature.name, item] as const))(
    'agree on %s / %s',
    (_environment, _feature, { environment, feature }) => {
      const count = feature.num_identity_overrides ?? 0;
      const flagApiResponse = environment.flags[feature.name];
      if (flagApiResponse === undefined) {
        throw new Error(`no recorded flag API response for ${feature.name}`);
      }

      const fromDocument = fromEnvironmentDocument(
        environment.document,
        feature.id,
        segments,
        count,
      );
      const fromApi = fromFlagApi(flagApiResponse, segments, environment.document, count);

      expect(fromDocument).not.toBeNull();
      expect(fromApi.environmentDefault).toEqual(fromDocument?.environmentDefault);
      expect(fromApi.segmentOverrides).toEqual(fromDocument?.segmentOverrides);
      // The document lists identity overrides; the flag API side only has their count.
      expect(fromApi.identityOverrides).toEqual({ count });
      expect(fromDocument?.identityOverrides).toHaveLength(count);
    },
  );

  it('reads the integer value of free_shipping_threshold as a number from both', () => {
    const production = environments[2];
    const feature = production?.features.find((item) => item.name === 'free_shipping_threshold');
    if (production === undefined || feature === undefined) {
      throw new Error('the fixtures lack free_shipping_threshold in Production');
    }

    expect(
      fromEnvironmentDocument(production.document, feature.id, segments, 0)?.environmentDefault
        .value,
    ).toBe(50);
  });
});

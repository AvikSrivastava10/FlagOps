import { readFileSync } from 'node:fs';
import { FlagOpsError } from '@flagops/shared';
import { describe, expect, it } from 'vitest';
import {
  anchorLikePythonMatch,
  coerceTraitValue,
  evaluatedFlags,
  evaluateIdentities,
  evaluateIdentity,
  flagsReadBy,
  inValuesLikePython,
  prepareServerProfile,
  serverHashKey,
} from './server-profile.js';
import type {
  EnvironmentDocument,
  FeatureStateDoc,
  IdentityTrait,
  PreviewIdentity,
} from './types.js';

const fixtures = new URL('../../../test/fixtures/impact/', import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

const seeded = fixture('environment.seeded.json') as EnvironmentDocument;
const identities = fixture('identities.1000.json') as PreviewIdentity[];
const identity = (identifier: string) =>
  identities.find((candidate) => candidate.identifier === identifier)!;

describe('input normalisation', () => {
  it.each([
    ['42', 42],
    ['-7', -7],
    ['007', 7],
    ['1.50', 1.5],
    ['20.0', 20],
    ['1e3', '1e3'],
    [' 42', ' 42'],
    ['abc', 'abc'],
    ['', ''],
    ['12345678901234567890', '12345678901234567890'],
    [3, 3],
    [true, true],
    [null, null],
  ] as const)('reads the trait %j as Python does: %j', (value, expected) => {
    expect(coerceTraitValue(value)).toBe(expected);
  });

  it('anchors REGEX patterns at the start of the value, as re.match does', () => {
    const matches = (pattern: string, value: string) =>
      new RegExp(anchorLikePythonMatch(pattern)).test(value);

    expect(anchorLikePythonMatch('flagsmith\\.com$')).toBe('^(?:flagsmith\\.com$)');
    expect(matches('flagsmith\\.com$', 'a@flagsmith.com')).toBe(false);
    expect(matches('.*@flagsmith\\.com$', 'a@flagsmith.com')).toBe(true);
    expect(matches('a|b', 'cb')).toBe(false);
    expect(matches('', 'anything')).toBe(true);
  });

  it.each([
    ['enterprise,business', ['enterprise', 'business']],
    ['a,,b', ['a', '', 'b']],
    ['["DE","FR"]', ['DE', 'FR']],
    ['[1, 2, 3]', ['1', '2', '3']],
    ['[not json', ['[not json']],
    ['["1.0", "2e3"]', ['1.0', '2e3']],
    ['[-0, 7]', ['0', '7']],
    // Python compares with "1.5", "1.0", "1000.0", "True", "nan" and all 20 digits, which parsed
    // JSON cannot give back, so these stay for the divergence lint.
    ['[1.5, 2]', '[1.5, 2]'],
    ['[1.0, 2]', '[1.0, 2]'],
    ['[1e3]', '[1e3]'],
    ['[true]', '[true]'],
    ['[NaN, 1]', '[NaN, 1]'],
    ['[12345678901234567890]', '[12345678901234567890]'],
  ] as const)('splits the IN value %s as Python does', (value, expected) => {
    expect(inValuesLikePython(value)).toEqual(expected);
  });
});

describe('the server profile', () => {
  it('hashes by the composite key or by Identity.id, as the environment says (R12)', () => {
    const someone = { identifier: 'user_00001', identityId: 70001 };

    expect(
      serverHashKey({ environmentKey: 'Prod', useCompositeKeyForHashing: true }, someone),
    ).toBe('Prod_user_00001');
    expect(
      serverHashKey({ environmentKey: 'Prod', useCompositeKeyForHashing: false }, someone),
    ).toBe('70001');
  });

  it('names what decided each result', async () => {
    const profile = await prepareServerProfile(seeded);

    const { flags } = evaluateIdentity(profile, identity('user_00042'));

    // user_00042 has its own override of recommendations_v2. It lives in France and was last
    // seen 163 days ago, so both eu_customers (priority 0) and dormant_users (1) match it.
    expect(flags['recommendations_v2']).toMatchObject({
      featureId: 300005,
      enabled: true,
      value: 'v2-grid',
      source: { kind: 'identity_override' },
    });
    expect(flags['holiday_banner']).toMatchObject({
      enabled: true,
      value: 'Winterschlussverkauf',
      source: { kind: 'segment', segmentId: 103, segmentName: 'eu_customers', priority: 0 },
    });
    expect(flags['checkout_steps']?.source).toEqual({ kind: 'default' });
    expect(profile.flags).toHaveLength(20);
  });

  it('gives each identity only its own overrides, even with commas in identifiers (R9)', async () => {
    const edge = fixture('environment.edge.json') as EnvironmentDocument;
    const people = ['team,alpha', 'team', 'alpha', 'solo'].map((identifier, index) => ({
      identifier,
      identityId: index + 1,
      traits: {},
    }));
    const profile = await prepareServerProfile(edge, { flags: ['probe_comma_identifier'] });

    const enabled = evaluateIdentities(profile, people).map(
      ({ identifier, flags }) =>
        `${identifier}: ${String(flags['probe_comma_identifier']?.enabled)}`,
    );

    expect(enabled).toEqual(['team,alpha: true', 'team: false', 'alpha: false', 'solo: true']);
  });

  it('serves a disabled flag without its value when the environment hides disabled flags', async () => {
    const shown = await prepareServerProfile(seeded);
    const hiddenByEnvironment = await prepareServerProfile({
      ...seeded,
      hide_disabled_flags: true,
    });
    const hiddenByProject = await prepareServerProfile({
      ...seeded,
      project: { ...seeded.project, hide_disabled_flags: true },
    });
    const keptByEnvironment = await prepareServerProfile({
      ...seeded,
      hide_disabled_flags: false,
      project: { ...seeded.project, hide_disabled_flags: true },
    });
    // user_00000 gets recommendations_v2 OFF from the dependency override, with the value "v1".
    const someone = identity('user_00000');

    expect(evaluateIdentity(shown, someone).flags['recommendations_v2']).toMatchObject({
      enabled: false,
      value: 'v1',
      variant: 'control',
      fromSplit: true,
    });
    for (const profile of [hiddenByEnvironment, hiddenByProject]) {
      expect(profile.hideDisabledFlags).toBe(true);
      const { flags } = evaluateIdentity(profile, someone);
      expect(flags['recommendations_v2']).toMatchObject({
        enabled: false,
        value: null,
        variant: null,
        fromSplit: false,
      });
      expect(flags['checkout_steps']).toMatchObject({ enabled: true, value: 3, fromSplit: false });
    }
    expect(keptByEnvironment.hideDisabledFlags).toBe(false);
  });

  it('looks up traits named like object members as the Python engine does', async () => {
    const document: EnvironmentDocument = {
      ...seeded,
      feature_states: [],
      identity_overrides: [],
      project: {
        ...seeded.project,
        segments: [
          { property_: 'constructor', operator: 'IS_SET', value: null },
          { property_: '__proto__', operator: 'EQUAL', value: 'x' },
        ].map((condition, index) => ({
          id: index + 1,
          name: `segment_${index + 1}`,
          rules: [{ type: 'ALL' as const, rules: [], conditions: [condition] }],
          feature_states: [],
        })),
      },
    };
    const flag = (name: string, segmentIndex: number, enabled: boolean): FeatureStateDoc => ({
      django_id: 10 + segmentIndex,
      enabled,
      feature: { id: segmentIndex, name, type: 'STANDARD' },
      feature_segment: enabled ? { priority: 0 } : null,
      feature_state_value: null,
      featurestate_uuid: `uuid-${name}-${String(enabled)}`,
      multivariate_feature_state_values: [],
    });
    for (const [index, name] of ['constructor_set', 'proto_is_x'].entries()) {
      document.feature_states.push(flag(name, index, false));
      document.project.segments[index]?.feature_states.push(flag(name, index, true));
    }
    const profile = await prepareServerProfile(document);
    const someone: PreviewIdentity = { identifier: 'u1', identityId: 1, traits: {} };
    const withProto: PreviewIdentity = {
      identifier: 'u2',
      identityId: 2,
      traits: JSON.parse('{"__proto__": {"value": "x", "valueType": "unicode"}}') as Record<
        string,
        IdentityTrait
      >,
    };

    // Python's dict has no "constructor" key, and "__proto__" is a key like any other.
    expect(evaluateIdentity(profile, someone).flags['constructor_set']?.enabled).toBe(false);
    expect(evaluateIdentity(profile, withProto).flags['proto_is_x']?.enabled).toBe(true);
  });

  it('refuses a flag named like an object member, on which the engine fails', async () => {
    const document = structuredClone(seeded);
    const darkMode = document.feature_states.find((state) => state.feature.name === 'dark_mode');
    darkMode!.feature.name = 'constructor';

    await expect(prepareServerProfile(document)).rejects.toMatchObject({
      code: 'internal_error',
      details: { feature: 'constructor' },
    });
  });

  it('refuses a multivariate state without a bucketing seed, and only such a state', async () => {
    const withoutSeed = structuredClone(seeded);
    for (const state of withoutSeed.feature_states) {
      if (state.feature.name === 'recommendations_v2' || state.feature.name === 'dark_mode') {
        state.django_id = null;
      }
    }

    await expect(prepareServerProfile(withoutSeed)).rejects.toMatchObject({
      code: 'flagsmith_unexpected_response',
      details: { feature: 'recommendations_v2' },
    });
    await expect(prepareServerProfile(withoutSeed)).rejects.toBeInstanceOf(FlagOpsError);
    await expect(
      prepareServerProfile(withoutSeed, { flags: ['dark_mode'] }),
    ).resolves.toMatchObject({ flags: ['dark_mode'] });
  });
});

describe('the evaluated flags', () => {
  it('add the dependents of a changed flag, and the prerequisites they read', () => {
    expect(evaluatedFlags([seeded], ['new_checkout'])).toEqual([
      'new_checkout',
      'recommendations_v2',
    ]);
    expect(evaluatedFlags([seeded], ['recommendations_v2'])).toEqual([
      'new_checkout',
      'recommendations_v2',
    ]);
    expect(evaluatedFlags([seeded], ['holiday_banner'])).toEqual(['holiday_banner']);
  });

  it('give the same results as evaluating every flag', { timeout: 60_000 }, async () => {
    const proposed = fixture('environment.proposed.json') as EnvironmentDocument;
    const flags = evaluatedFlags([seeded, proposed], ['new_checkout', 'holiday_banner']);
    const people = identities.slice(0, 250);

    for (const document of [seeded, proposed]) {
      const full = evaluateIdentities(await prepareServerProfile(document), people);
      const restricted = evaluateIdentities(
        await prepareServerProfile(document, { flags }),
        people,
      );
      expect(restricted).toEqual(
        full.map((evaluation) => ({
          ...evaluation,
          flags: Object.fromEntries(flags.map((flag) => [flag, evaluation.flags[flag]])),
        })),
      );
    }
  });

  it('find the flags a segment reads through $.flags', () => {
    const read = flagsReadBy([
      {
        type: 'ALL',
        conditions: [
          { operator: 'NOT_EQUAL', property_: '$.flags["new_checkout"].enabled', value: 'true' },
          { operator: 'EQUAL', property_: '$.flags.dark_mode.value', value: 'dark' },
          { operator: 'EQUAL', property_: 'plan', value: 'pro' },
        ],
        rules: [
          {
            type: 'ANY',
            rules: [],
            conditions: [
              { operator: 'EQUAL', property_: "$.flags['holiday_banner'].enabled", value: 'true' },
              { operator: 'EQUAL', property_: '$.flags["say \\"hi\\""].enabled', value: 'true' },
            ],
          },
        ],
      },
    ]);

    expect([...read].sort()).toEqual(['dark_mode', 'holiday_banner', 'new_checkout', 'say "hi"']);
  });
});

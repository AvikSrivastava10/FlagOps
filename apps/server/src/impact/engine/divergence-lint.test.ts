import { describe, expect, it } from 'vitest';
import { lintDivergences } from './divergence-lint.js';
import type {
  EnvironmentDocument,
  FeatureStateDoc,
  IdentityTrait,
  PreviewIdentity,
  SegmentConditionDoc,
  SegmentDoc,
} from './types.js';

function override(flag: string): FeatureStateDoc {
  return {
    django_id: null,
    enabled: true,
    feature: { id: flag.length, name: flag, type: 'STANDARD' },
    feature_segment: { priority: 0 },
    feature_state_value: null,
    featurestate_uuid: `uuid-${flag}`,
    multivariate_feature_state_values: [],
  };
}

function segment(id: number, condition: SegmentConditionDoc, flags: string[]): SegmentDoc {
  return {
    id,
    name: `segment_${id}`,
    rules: [
      { type: 'ALL', rules: [{ type: 'ANY', rules: [], conditions: [condition] }], conditions: [] },
    ],
    feature_states: flags.map(override),
  };
}

function documentWith(
  segments: SegmentDoc[],
  settings: Partial<EnvironmentDocument> = {},
): EnvironmentDocument {
  return {
    api_key: 'env',
    name: 'Production',
    use_identity_composite_key_for_hashing: true,
    hide_disabled_flags: null,
    feature_states: [],
    identity_overrides: [],
    project: { hide_disabled_flags: false, segments },
    ...settings,
  };
}

const condition = (property: string, operator: string, value: string | null) => ({
  property_: property,
  operator,
  value,
});
const trait = (value: IdentityTrait['value'], valueType: IdentityTrait['valueType']) => ({
  value,
  valueType,
});
const person = (identifier: string, traits: Record<string, IdentityTrait>): PreviewIdentity => ({
  identifier,
  identityId: 1,
  traits,
});

/** The cause codes the lint gives one condition, for one identity per value of the trait `t`. */
function codesFor(
  found: SegmentConditionDoc,
  values: IdentityTrait[],
  {
    identifier = 'user_1',
    ...settings
  }: { identifier?: string } & Partial<EnvironmentDocument> = {},
) {
  const people =
    values.length === 0
      ? [person(identifier, {})]
      : values.map((value) => person(identifier, { t: value }));
  const lint = lintDivergences([documentWith([segment(1, found, ['flag'])], settings)], people);
  return lint.warnings.map((warning) => warning.cause.code);
}

// The spike's edge probes and the P3 divergence probes ran these conditions through both engines.
// A case expects no warning only where the two engines gave the same result.
describe('lintDivergences', () => {
  it.each([
    [
      'a REGEX pattern JavaScript rejects',
      condition('t', 'REGEX', '(?P<who>x)'),
      [trait('x', 'unicode')],
      ['R2'],
    ],
    ['REGEX on a boolean trait', condition('t', 'REGEX', '^true$'), [trait(true, 'bool')], ['R3']],
    [
      'REGEX on a float Python writes with an exponent',
      condition('t', 'REGEX', '^1'),
      [trait(0.00001, 'float')],
      ['R3'],
    ],
    ['REGEX on a whole float', condition('t', 'REGEX', '^1\\.0$'), [trait(1, 'float')], ['R13']],
    [
      'REGEX on a decimal string',
      condition('t', 'REGEX', '^2'),
      [trait('20.0', 'unicode')],
      ['R13'],
    ],
    [
      'REGEX on a float both write alike',
      condition('t', 'REGEX', '^1\\.5$'),
      [trait(1.5, 'float')],
      [],
    ],
    [
      'REGEX on text',
      condition('t', 'REGEX', '.*@flagsmith\\.com$'),
      [trait('a@b.c', 'unicode')],
      [],
    ],
    [
      'an integer compared with a decimal',
      condition('t', 'GREATER_THAN', '42.5'),
      [trait(43, 'int')],
      ['R5'],
    ],
    [
      'an integer compared with text',
      condition('t', 'NOT_EQUAL', 'abc'),
      [trait(5, 'int')],
      ['R5'],
    ],
    ['a float compared with text', condition('t', 'EQUAL', 'abc'), [trait(1.5, 'float')], ['R5']],
    [
      'an integer compared with an integer',
      condition('t', 'GREATER_THAN_INCLUSIVE', ' 20 '),
      [trait(20, 'int')],
      [],
    ],
    ['a semver comparison', condition('t', 'GREATER_THAN', '2.0.0:semver'), [trait(2, 'int')], []],
    ['IN on a float trait', condition('t', 'IN', '1.5,2.5'), [trait(1.5, 'float')], ['R6']],
    ['IN on a whole float', condition('t', 'IN', '[1, 2, 3]'), [trait(3, 'float')], ['R13']],
    ['IN on a trait that is 0', condition('t', 'IN', '0,1'), [trait(0, 'int')], ['R6']],
    ['IN on an empty trait', condition('t', 'IN', 'a,,b'), [trait('', 'unicode')], ['R6']],
    ['IN with a JSON list of floats', condition('t', 'IN', '[1.5, 2]'), [trait(2, 'int')], ['R6']],
    [
      'IN on a boolean trait, which neither engine matches',
      condition('t', 'IN', 'True,true'),
      [trait(true, 'bool')],
      [],
    ],
    ['IN with a JSON list of text', condition('t', 'IN', '["a","b"]'), [trait('a', 'unicode')], []],
    ['MODULO on a boolean trait', condition('t', 'MODULO', '2|1'), [trait(true, 'bool')], ['R7']],
    [
      'MODULO on text that starts with a number',
      condition('t', 'MODULO', '2|1'),
      [trait('3px', 'unicode')],
      ['R7'],
    ],
    ['MODULO on other text', condition('t', 'MODULO', '2|1'), [trait('abc', 'unicode')], []],
    [
      'MODULO with letters in its value',
      condition('t', 'MODULO', '2abc|1'),
      [trait(3, 'int')],
      ['R5'],
    ],
    [
      'MODULO with an underscore in its value',
      condition('t', 'MODULO', '1_0|3'),
      [trait(13, 'int')],
      ['R5'],
    ],
    ['MODULO on a negative trait', condition('t', 'MODULO', '2|1'), [trait(-3, 'int')], ['R15']],
    ['MODULO by a negative divisor', condition('t', 'MODULO', '-2|1'), [trait(3, 'int')], ['R15']],
    ['MODULO by zero', condition('t', 'MODULO', '0|0'), [trait(4, 'int')], ['R15']],
    ['MODULO on an integer trait', condition('t', 'MODULO', '2|1'), [trait(3, 'int')], []],
    [
      'a percentage split on a plain trait name',
      condition('t', 'PERCENTAGE_SPLIT', '50'),
      [trait(1, 'int')],
      ['R8'],
    ],
    [
      'a percentage split on a trait that is 0',
      condition('$.identity.traits.t', 'PERCENTAGE_SPLIT', '100'),
      [trait(0, 'int')],
      ['R8'],
    ],
    [
      'a percentage split on an empty trait',
      condition('$.identity.traits.t', 'PERCENTAGE_SPLIT', '100'),
      [trait('', 'unicode')],
      ['R8'],
    ],
    [
      'a percentage split on a boolean trait',
      condition('$.identity.traits.t', 'PERCENTAGE_SPLIT', '50'),
      [trait(true, 'bool')],
      ['R3'],
    ],
    [
      'a percentage split on a float Python writes with an exponent',
      condition('$.identity.traits.t', 'PERCENTAGE_SPLIT', '50'),
      [trait(0.00001, 'float')],
      ['R3'],
    ],
    [
      'a percentage split on a float both write alike',
      condition('$.identity.traits.t', 'PERCENTAGE_SPLIT', '50'),
      [trait(1.25, 'float')],
      [],
    ],
    [
      'a percentage split whose value has letters',
      condition('', 'PERCENTAGE_SPLIT', '100abc'),
      [],
      ['R5'],
    ],
    [
      'a percentage split on the identity key',
      condition('', 'PERCENTAGE_SPLIT', '50'),
      [trait(true, 'bool')],
      [],
    ],
    [
      'a condition through a quoted trait path',
      condition("$.identity.traits['t']", 'GREATER_THAN', '1.5'),
      [trait(2, 'int')],
      ['R5'],
    ],
    ['IS_NOT_SET without a property', condition('', 'IS_NOT_SET', null), [], ['R16']],
    ['EQUAL without a property', condition('', 'EQUAL', ''), [], []],
    [
      'a trait path with a dot in the name',
      condition('$.identity.traits.a.b', 'EQUAL', 'x'),
      [],
      ['R16'],
    ],
    [
      'a trait path starting with a digit',
      condition('$.identity.traits.1st', 'EQUAL', 'x'),
      [],
      ['R16'],
    ],
    [
      'a $.flags path other than a dependency',
      condition('$.flags.banner.value', 'EQUAL', 'x'),
      [],
      ['R16'],
    ],
    ['a trait path with a hyphen', condition('$.identity.traits.my-trait', 'EQUAL', 'x'), [], []],
    [
      'a single-quoted trait path with a dot',
      condition("$.identity.traits['a.b']", 'EQUAL', 'x'),
      [],
      [],
    ],
    ['a double-quoted trait path', condition('$.identity.traits["t"]', 'EQUAL', 'x'), [], []],
    ['a flag dependency', condition('$.flags["banner"].enabled', 'NOT_EQUAL', 'true'), [], []],
  ] as const)('marks %s', (_description, found, values, codes) => {
    expect(codesFor(found, [...values])).toEqual(codes);
  });

  it('marks conditions on context values that Python reads as numbers (R4)', () => {
    const onIdentifier = condition('$.identity.identifier', 'EQUAL', '7');
    const onKey = condition('$.identity.key', 'CONTAINS', '1');
    const onName = condition('$.environment.name', 'EQUAL', '7');

    expect(codesFor(onIdentifier, [], { identifier: '007' })).toEqual(['R4']);
    expect(codesFor(onIdentifier, [], { identifier: 'user_007' })).toEqual([]);
    expect(
      codesFor(condition('$.identity.identifier', 'IS_SET', null), [], { identifier: '007' }),
    ).toEqual([]);
    // The key is Identity.id when composite hashing is off.
    expect(codesFor(onKey, [])).toEqual([]);
    expect(codesFor(onKey, [], { use_identity_composite_key_for_hashing: false })).toEqual(['R4']);
    expect(codesFor(onName, [], { name: '007' })).toEqual(['R4']);
    expect(codesFor(onName, [])).toEqual([]);
  });

  it('marks the flags of warned segments, and the flags that read those through $.flags (R10)', () => {
    const lint = lintDivergences(
      [
        documentWith([
          segment(1, condition('t', 'MODULO', '2|1'), ['flag_a']),
          segment(2, condition('$.flags["flag_a"].enabled', 'EQUAL', 'true'), ['flag_b']),
          segment(3, condition('$.flags["flag_b"].enabled', 'NOT_EQUAL', 'true'), ['flag_c']),
          segment(4, condition('plan', 'EQUAL', 'pro'), ['flag_d']),
        ]),
      ],
      [person('user_1', { t: trait(true, 'bool'), plan: trait('pro', 'unicode') })],
    );

    expect(lint.warnings).toEqual([
      {
        segmentId: 1,
        segmentName: 'segment_1',
        condition: condition('t', 'MODULO', '2|1'),
        cause: { code: 'R7', description: 'MODULO on a boolean trait' },
        flags: ['flag_a'],
      },
    ]);
    expect(lint.approximate).toEqual({
      flag_a: [{ code: 'R7', description: 'MODULO on a boolean trait' }],
      flag_b: [{ code: 'R10', description: 'reads flag_a through $.flags, which may differ' }],
      flag_c: [{ code: 'R10', description: 'reads flag_b through $.flags, which may differ' }],
    });
  });

  it('lints each segment once across documents, with the flags it overrides in any of them', () => {
    const before = documentWith([segment(1, condition('t', 'IN', '0,1'), ['flag_a'])]);
    const after = documentWith([segment(1, condition('t', 'IN', '0,1'), ['flag_a', 'flag_b'])]);

    const lint = lintDivergences([before, after], [person('user_1', { t: trait(0, 'int') })]);

    expect(lint.warnings).toHaveLength(1);
    expect(lint.warnings[0]?.flags).toEqual(['flag_a', 'flag_b']);
    expect(Object.keys(lint.approximate)).toEqual(['flag_a', 'flag_b']);
  });

  it('skips segments that override no flag', () => {
    const lint = lintDivergences(
      [documentWith([segment(1, condition('t', 'MODULO', '2|1'), [])])],
      [person('user_1', { t: trait(true, 'bool') })],
    );

    expect(lint).toEqual({ warnings: [], approximate: {} });
  });
});

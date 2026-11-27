import { describe, expect, it } from 'vitest';
import type { DocumentFeatureState, EnvironmentDocument } from '../document.js';
import { fromEnvironmentDocument, fromFlagApi, fromFlagApiValue } from './flag-config.js';
import { dependencyPrerequisite, segmentKind } from './segment-kinds.js';

function state(featureId: number, enabled: boolean, priority: number | null): DocumentFeatureState {
  return {
    feature: { id: featureId, name: 'flag' },
    enabled,
    feature_state_value: null,
    feature_segment: priority === null ? null : { priority },
    multivariate_feature_state_values: [],
  };
}

const dependencyRules = [
  {
    type: 'ANY',
    rules: [],
    conditions: [
      { operator: 'NOT_EQUAL', property_: '$.flags["new_checkout"].enabled', value: 'true' },
    ],
  },
];

describe('fromFlagApiValue', () => {
  it.each([
    [{ type: 'integer', value: '50' }, 50],
    [{ type: 'boolean', value: 'true' }, true],
    [{ type: 'boolean', value: 'false' }, false],
    [{ type: 'string', value: '1.5' }, '1.5'],
    [null, null],
  ] as const)('maps %o to %o', (value, expected) => {
    expect(fromFlagApiValue(value)).toBe(expected);
  });
});

describe('segment kinds', () => {
  const listed = new Map([
    [1, { id: 1, managed_by: '' }],
    [2, { id: 2, managed_by: 'cohort' }],
  ]);

  it('calls a listed segment without a manager a user segment, and one with a manager managed', () => {
    expect(segmentKind(1, listed, undefined)).toEqual({ kind: 'user' });
    expect(segmentKind(2, listed, undefined)).toEqual({ kind: 'managed', managedBy: 'cohort' });
  });

  it('recognises the flag-dependency segment Flagsmith writes, which is never listed', () => {
    expect(segmentKind(3, listed, dependencyRules)).toEqual({
      kind: 'dependency',
      prerequisite: 'new_checkout',
    });
  });

  it('calls any other unlisted segment a system segment', () => {
    expect(segmentKind(3, listed, undefined)).toEqual({ kind: 'system' });
    expect(segmentKind(3, listed, [])).toEqual({ kind: 'system' });
  });

  it('reads a prerequisite name as the JSON string Flagsmith writes', () => {
    expect(
      dependencyPrerequisite([
        {
          type: 'ANY',
          rules: [],
          conditions: [
            {
              operator: 'NOT_EQUAL',
              property_: '$.flags["a \\"quoted\\" name"].enabled',
              value: 'true',
            },
          ],
        },
      ]),
    ).toBe('a "quoted" name');
  });

  it.each([
    [
      'another operator',
      [
        {
          ...dependencyRules[0],
          conditions: [{ operator: 'EQUAL', property_: '$.flags["x"].enabled', value: 'true' }],
        },
      ],
    ],
    ['an ALL rule', [{ ...dependencyRules[0], type: 'ALL' }]],
    [
      'two conditions',
      [
        {
          ...dependencyRules[0],
          conditions: [
            ...(dependencyRules[0]?.conditions ?? []),
            { operator: 'EQUAL', property_: 'a', value: 'b' },
          ],
        },
      ],
    ],
    ['a nested rule', [{ ...dependencyRules[0], rules: dependencyRules }]],
    [
      'a property that is not a flag',
      [
        {
          ...dependencyRules[0],
          conditions: [{ operator: 'NOT_EQUAL', property_: 'plan', value: 'true' }],
        },
      ],
    ],
  ])('does not take a segment with %s for a dependency', (_what, rules) => {
    expect(dependencyPrerequisite(rules as typeof dependencyRules)).toBeNull();
  });
});

describe('fromEnvironmentDocument', () => {
  function documentWith(overrides: Partial<EnvironmentDocument>): EnvironmentDocument {
    return {
      api_key: 'key',
      feature_states: [state(1, true, null)],
      project: { segments: [] },
      identity_overrides: [],
      use_identity_overrides_in_local_eval: true,
      ...overrides,
    };
  }

  it('returns null when the document has no feature state for the flag', () => {
    expect(fromEnvironmentDocument(documentWith({}), 2, [], 0)).toBeNull();
  });

  it('sorts segment overrides by priority, then segment ID, and classifies them', () => {
    const document = documentWith({
      project: {
        segments: [
          {
            id: 9,
            name: 'dependency',
            rules: dependencyRules,
            feature_states: [state(1, false, 0)],
          },
          { id: 5, name: 'beta', rules: [], feature_states: [state(1, true, 1)] },
        ],
      },
    });

    expect(
      fromEnvironmentDocument(document, 1, [{ id: 5, managed_by: '' }], 0)?.segmentOverrides.map(
        (override) => [override.segmentId, override.priority, override.segment.kind],
      ),
    ).toEqual([
      [9, 0, 'dependency'],
      [5, 1, 'user'],
    ]);
  });

  it('uses the count from the feature list when the environment leaves identity overrides out of its document', () => {
    const document = documentWith({ use_identity_overrides_in_local_eval: false });

    expect(fromEnvironmentDocument(document, 1, [], 4)?.identityOverrides).toEqual({ count: 4 });
  });

  it('sorts weights by option and identity overrides by identifier', () => {
    const document = documentWith({
      feature_states: [
        {
          ...state(1, true, null),
          multivariate_feature_state_values: [
            { multivariate_feature_option: { id: 8 }, percentage_allocation: 20 },
            { multivariate_feature_option: { id: 3 }, percentage_allocation: 30 },
          ],
        },
      ],
      identity_overrides: [
        { identifier: 'user-2', identity_features: [state(1, true, null)] },
        { identifier: 'user-10', identity_features: [state(1, false, null)] },
      ],
    });

    const config = fromEnvironmentDocument(document, 1, [], 2);
    expect(config?.environmentDefault.variants).toEqual([
      { optionId: 3, weight: 30 },
      { optionId: 8, weight: 20 },
    ]);
    expect(config?.identityOverrides).toEqual([
      { identifier: 'user-10', enabled: false, value: null },
      { identifier: 'user-2', enabled: true, value: null },
    ]);
  });
});

describe('fromFlagApi', () => {
  it('classifies a system-segment override with the rules from the document', () => {
    const document: EnvironmentDocument = {
      api_key: 'key',
      feature_states: [],
      project: {
        segments: [{ id: 9, name: 'dependency', rules: dependencyRules, feature_states: [] }],
      },
      identity_overrides: [],
      use_identity_overrides_in_local_eval: true,
    };

    const config = fromFlagApi(
      {
        environment_default: {
          enabled: true,
          value: { type: 'integer', value: '3' },
          variants: [],
        },
        segment_overrides: [
          { segment: { id: 9 }, priority: 0, enabled: false, value: null, variants: [] },
        ],
      },
      [],
      document,
      0,
    );

    expect(config.environmentDefault).toEqual({ enabled: true, value: 3, variants: [] });
    expect(config.segmentOverrides[0]?.segment).toEqual({
      kind: 'dependency',
      prerequisite: 'new_checkout',
    });
  });
});

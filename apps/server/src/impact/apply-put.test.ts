import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyFlagPut,
  type AppliedPut,
  type FlagPutBody,
  type ProjectSegment,
  type PutRejection,
} from './apply-put.js';
import type { EnvironmentDocument, FeatureStateDoc, FlagValue } from './engine/types.js';

const fixtures = new URL('../../test/fixtures/impact/', import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

const seeded = fixture('environment.seeded.json') as EnvironmentDocument;
const segments = fixture('segments.json') as ProjectSegment[];

const HOLIDAY_BANNER = 300003;
const RECOMMENDATIONS_V2 = 300005;

type FlagState = {
  enabled: boolean;
  value: FlagValue;
  variants: { id: number | null; weight: number }[];
};
type FlagPart = {
  environmentDefault: FlagState;
  segmentOverrides: (FlagState & { segment: number; priority: number | null })[];
};
type PutCase = {
  name: string;
  featureId: number;
  body: FlagPutBody;
  expected:
    | { rejection: PutRejection }
    | (Pick<
        AppliedPut,
        'createdSegmentIds' | 'updatedSegmentIds' | 'deletedSegmentIds' | 'estimatedSplitSegmentIds'
      > & { flag: FlagPart });
};
type ProposedChange = { title: string; featureId: number; body: FlagPutBody };

function stateOf(state: FeatureStateDoc): FlagState {
  return {
    enabled: state.enabled,
    value: state.feature_state_value,
    variants: state.multivariate_feature_state_values
      .map((weight) => ({
        id: weight.multivariate_feature_option.id,
        weight: weight.percentage_allocation,
      }))
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
  };
}

/** The flag's part of a document, as the declarative API's GET would show it. */
function flagPart(document: EnvironmentDocument, featureId: number): FlagPart {
  const environmentDefault = document.feature_states.find(
    (state) => state.feature.id === featureId,
  )!;
  const segmentOverrides = document.project.segments
    .flatMap((segment) =>
      segment.feature_states
        .filter((state) => state.feature.id === featureId)
        .map((state) => ({
          segment: segment.id,
          priority: state.feature_segment?.priority ?? null,
          ...stateOf(state),
        })),
    )
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.segment - b.segment);
  return { environmentDefault: stateOf(environmentDefault), segmentOverrides };
}

/** The document without the flag's states, which a PUT for that flag must leave alone. */
function withoutFlag(document: EnvironmentDocument, featureId: number): EnvironmentDocument {
  const others = (states: FeatureStateDoc[]) =>
    states.filter((state) => state.feature.id !== featureId);
  return {
    ...document,
    feature_states: others(document.feature_states),
    project: {
      ...document.project,
      segments: document.project.segments.map((segment) => ({
        ...segment,
        feature_states: others(segment.feature_states),
      })),
    },
  };
}

function accepted(featureId: number, body: FlagPutBody, catalog = segments): AppliedPut {
  const outcome = applyFlagPut(seeded, featureId, body, catalog);
  if (!outcome.accepted) {
    throw new Error(`Rejected: ${outcome.rejection.message}`);
  }
  return outcome;
}

describe('applyFlagPut on the outcomes Flagsmith pins down', () => {
  const cases = fixture('put-cases.json') as PutCase[];

  it('replays the 17 cases of the PUT port', () => {
    expect(cases).toHaveLength(17);
  });

  it.each(cases)('$name', ({ featureId, body, expected }) => {
    const pristine = structuredClone(seeded);

    const outcome = applyFlagPut(seeded, featureId, body, segments);

    expect(seeded).toEqual(pristine);
    if ('rejection' in expected) {
      expect(outcome).toEqual({ accepted: false, rejection: expected.rejection });
      return;
    }
    if (!outcome.accepted) {
      throw new Error(`Rejected: ${outcome.rejection.message}`);
    }
    expect({
      flag: flagPart(outcome.document, featureId),
      createdSegmentIds: outcome.createdSegmentIds,
      updatedSegmentIds: outcome.updatedSegmentIds,
      deletedSegmentIds: outcome.deletedSegmentIds,
      estimatedSplitSegmentIds: outcome.estimatedSplitSegmentIds,
    }).toEqual(expected);
    expect(withoutFlag(outcome.document, featureId)).toEqual(withoutFlag(seeded, featureId));
  });
});

describe('applyFlagPut', () => {
  it('writes nothing for a body without parts', () => {
    const outcome = accepted(HOLIDAY_BANNER, {});

    expect(outcome.document).toEqual(seeded);
    expect(outcome.document).not.toBe(seeded);
    expect(outcome.createdSegmentIds).toEqual([]);
    expect(outcome.deletedSegmentIds).toEqual([]);
  });

  it('answers 404 for a flag the environment does not have', () => {
    expect(applyFlagPut(seeded, 999, { environment_default: { enabled: true } }, segments)).toEqual(
      {
        accepted: false,
        rejection: {
          status: 404,
          code: 'feature_not_found',
          message: "Feature ID '999' does not exist in the project.",
        },
      },
    );
  });

  it('adds a listed segment that the document lacks, as the next document would', () => {
    const staff: ProjectSegment = {
      id: 120,
      name: 'staff',
      rules: [
        {
          type: 'ALL',
          rules: [],
          conditions: [{ operator: 'EQUAL', property_: 'role', value: 'staff' }],
        },
      ],
    };

    const outcome = accepted(
      HOLIDAY_BANNER,
      {
        segment_overrides: [
          { segment: { id: 103 }, priority: 0 },
          { segment: { id: 120 }, priority: 1, enabled: false },
        ],
      },
      [...segments, staff],
    );

    const added = outcome.document.project.segments.find((segment) => segment.id === 120);
    expect(added).toMatchObject({ id: 120, name: 'staff', rules: staff.rules });
    expect(added?.feature_states).toHaveLength(1);
    expect(outcome.createdSegmentIds).toEqual([120]);
    expect(outcome.deletedSegmentIds).toEqual([108]);
  });

  it('reports the lowest priority that two overrides share', () => {
    const outcome = applyFlagPut(
      seeded,
      HOLIDAY_BANNER,
      {
        segment_overrides: [
          { segment: { id: 103 }, priority: 5 },
          { segment: { id: 108 }, priority: 5 },
          { segment: { id: 104 }, priority: 2 },
          { segment: { id: 101 }, priority: 2 },
        ],
      },
      segments,
    );

    expect(outcome).toEqual({
      accepted: false,
      rejection: { status: 400, message: 'Duplicate priority: 2.' },
    });
  });

  it('refuses a negative priority', () => {
    const outcome = applyFlagPut(
      seeded,
      HOLIDAY_BANNER,
      { segment_overrides: [{ segment: { id: 103 }, priority: -1 }] },
      segments,
    );

    expect(outcome).toEqual({
      accepted: false,
      rejection: {
        status: 400,
        message: 'Ensure this value is greater than or equal to 0.',
        field: 'segment_overrides[0].priority',
      },
    });
  });

  it.each([-2147483648, 2147483647])(
    'accepts the integer %i, which the Postgres integer column stores',
    (integer) => {
      const outcome = accepted(HOLIDAY_BANNER, {
        environment_default: { enabled: true, value: { type: 'integer', value: String(integer) } },
      });

      const environmentDefault = outcome.document.feature_states.find(
        (state) => state.feature.id === HOLIDAY_BANNER,
      );
      expect(environmentDefault?.feature_state_value).toBe(integer);
    },
  );

  it.each(['-2147483649', '2147483648'])(
    'refuses the integer %s, which the Postgres integer column cannot store',
    (integer) => {
      const outcome = applyFlagPut(
        seeded,
        HOLIDAY_BANNER,
        { environment_default: { enabled: true, value: { type: 'integer', value: integer } } },
        segments,
      );

      expect(outcome).toEqual({
        accepted: false,
        rejection: {
          status: 400,
          message: `'${integer}' is out of range for a Flagsmith integer value`,
          field: 'environment_default.value',
        },
      });
    },
  );

  it('estimates nothing when a new override serves one variant to everyone', () => {
    const outcome = accepted(RECOMMENDATIONS_V2, {
      environment_default: {
        enabled: true,
        value: { type: 'string', value: 'v1' },
        variants: [
          { id: 201, weight: 20 },
          { id: 202, weight: 20 },
        ],
      },
      segment_overrides: [
        {
          segment: { id: 101 },
          priority: 1,
          variants: [
            { id: 201, weight: 100 },
            { id: 202, weight: 0 },
          ],
        },
      ],
    });

    expect(outcome.createdSegmentIds).toEqual([101]);
    expect(outcome.estimatedSplitSegmentIds).toEqual([]);
  });

  it('gives the rows it creates IDs above every ID in the document, and placeholder UUIDs', () => {
    const outcome = accepted(RECOMMENDATIONS_V2, {
      environment_default: {
        enabled: true,
        value: { type: 'string', value: 'v1' },
        variants: [
          { id: 201, weight: 20 },
          { id: 202, weight: 20 },
        ],
      },
      segment_overrides: [{ segment: { id: 101 }, priority: 1 }],
    });

    const created = outcome.document.project.segments
      .find((segment) => segment.id === 101)
      ?.feature_states.find((state) => state.feature.id === RECOMMENDATIONS_V2);
    // The seeded document's highest row ID is 2000023.
    expect(created).toMatchObject({
      django_id: 2000024,
      featurestate_uuid: '00000000-0000-4000-8000-0000001e8498',
    });
    expect(created?.multivariate_feature_state_values.map((weight) => weight.id)).toEqual([
      2000025, 2000026,
    ]);
  });
});

describe('the proposed documents', () => {
  const changes = fixture('proposed-changes.json') as ProposedChange[];
  const applyAll = (document: EnvironmentDocument) =>
    changes.reduce((current, change) => {
      const outcome = applyFlagPut(current, change.featureId, change.body, segments);
      if (!outcome.accepted) {
        throw new Error(`${change.title}: ${outcome.rejection.message}`);
      }
      return outcome.document;
    }, document);

  it.each([
    ['environment.seeded.json', 'environment.proposed.json'],
    ['environment.seeded-legacy-hashing.json', 'environment.proposed-legacy-hashing.json'],
  ])(
    'come from applying the three proposed changes to %s, the same every time',
    async (from, to) => {
      const document = fixture(from) as EnvironmentDocument;

      const proposed = applyAll(document);

      expect(applyAll(document)).toEqual(proposed);
      // The Python goldens of the parity suite were computed from these files.
      await expect(`${JSON.stringify(proposed, null, 2)}\n`).toMatchFileSnapshot(
        `../../test/fixtures/impact/${to}`,
      );
    },
  );
});

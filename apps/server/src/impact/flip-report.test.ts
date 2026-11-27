import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyFlagPut, type FlagPutBody, type ProjectSegment } from './apply-put.js';
import {
  evaluatedFlags,
  evaluateIdentities,
  prepareServerProfile,
} from './engine/server-profile.js';
import type {
  EnvironmentDocument,
  EvaluationRun,
  FlagOutcome,
  PreviewIdentity,
} from './engine/types.js';
import { buildFlipReport, type FlagImpact } from './flip-report.js';

const fixtures = new URL('../../test/fixtures/impact/', import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

const seeded = fixture('environment.seeded.json') as EnvironmentDocument;
const segments = fixture('segments.json') as ProjectSegment[];
const identities = fixture('identities.1000.json') as PreviewIdentity[];
const changes = fixture('proposed-changes.json') as {
  title: string;
  featureId: number;
  body: FlagPutBody;
}[];

/** Applies the first `count` of the spike's proposed changes, as a preview would. */
function propose(count: number) {
  let document = seeded;
  const changed: string[] = [];
  const estimatedSplits: Record<string, number[]> = {};
  for (const change of changes.slice(0, count)) {
    const outcome = applyFlagPut(document, change.featureId, change.body, segments);
    if (!outcome.accepted) {
      throw new Error(`${change.title}: ${outcome.rejection.message}`);
    }
    document = outcome.document;
    changed.push(outcome.feature.name);
    estimatedSplits[outcome.feature.name] = outcome.estimatedSplitSegmentIds;
  }
  return { document, flags: evaluatedFlags([seeded, document], changed), estimatedSplits };
}

async function evaluate(document: EnvironmentDocument, flags?: string[]) {
  return evaluateIdentities(
    await prepareServerProfile(document, flags === undefined ? {} : { flags }),
    identities,
  );
}

const summary = (impact: FlagImpact | undefined) =>
  impact && {
    changed: impact.changed,
    unchanged: impact.unchanged,
    ...impact.counts,
    valueEstimated: impact.valueEstimated,
  };

describe('the flip report on the spike fixtures', () => {
  const first = propose(1);
  const all = propose(3);
  const runs = {} as Record<
    'firstBefore' | 'firstAfter' | 'fullBefore' | 'fullAfter' | 'before' | 'after',
    EvaluationRun
  >;

  beforeAll(async () => {
    runs.firstBefore = await evaluate(seeded, first.flags);
    runs.firstAfter = await evaluate(first.document, first.flags);
    runs.fullBefore = await evaluate(seeded);
    runs.fullAfter = await evaluate(all.document);
    runs.before = await evaluate(seeded, all.flags);
    runs.after = await evaluate(all.document, all.flags);
  }, 120_000);

  it('evaluates dependents: enabling new_checkout flips its dependent recommendations_v2', () => {
    const report = buildFlipReport(runs.firstBefore, runs.firstAfter);

    expect(first.flags).toEqual(['new_checkout', 'recommendations_v2']);
    const impact = (feature: string) => report.flags.find((flag) => flag.feature === feature);
    expect(impact('recommendations_v2')?.counts.offToOn).toBe(846);
    expect(impact('new_checkout')?.counts.offToOn).toBe(847);
  });

  it('reproduces the prototype run of the spike for its three changes', () => {
    const report = buildFlipReport(runs.fullBefore, runs.fullAfter, {
      estimatedSplits: all.estimatedSplits,
    });

    // REPORT section 3, "Flip report"; out/prototype-run.log in the spike.
    expect(report.flags.map((impact) => impact.feature).slice(0, 3)).toEqual([
      'recommendations_v2',
      'new_checkout',
      'holiday_banner',
    ]);
    const [recommendations, checkout, banner] = report.flags;
    expect(summary(recommendations)).toEqual({
      changed: 918,
      unchanged: 82,
      offToOn: 846,
      onToOff: 0,
      valueChanged: 72,
      valueChangedWhileOff: 0,
      valueEstimated: 55,
    });
    expect(recommendations?.transitions).toEqual([
      {
        before: 'segment recommendations_v2-depends-on-new_checkout #112',
        after: 'environment default',
        count: 409,
      },
      {
        before: 'segment recommendations_v2-depends-on-new_checkout #112',
        after: 'segment mobile_app_v2 #105',
        count: 264,
      },
      {
        before: 'segment recommendations_v2-depends-on-new_checkout #112',
        after: 'segment enterprise_accounts #102',
        count: 173,
      },
      { before: 'environment default', after: 'segment mobile_app_v2 #105', count: 33 },
      { before: 'environment default', after: 'environment default', count: 28 },
      {
        before: 'segment enterprise_accounts #102',
        after: 'segment enterprise_accounts #102',
        count: 11,
      },
    ]);
    expect(summary(checkout)).toMatchObject({ changed: 847, offToOn: 847, valueEstimated: 0 });
    expect(summary(banner)).toEqual({
      changed: 280,
      unchanged: 720,
      offToOn: 122,
      onToOff: 0,
      valueChanged: 158,
      valueChangedWhileOff: 0,
      valueEstimated: 0,
    });
    expect(report.flags.slice(3).every((impact) => impact.changed === 0)).toBe(true);
    expect(report.flags).toHaveLength(20);
  });

  it('marks values from the new split as estimated, and keeps their on/off result', () => {
    const report = buildFlipReport(runs.before, runs.after, {
      estimatedSplits: all.estimatedSplits,
    });

    expect(all.estimatedSplits).toEqual({
      new_checkout: [],
      holiday_banner: [],
      recommendations_v2: [105],
    });
    // 264 OFF to ON through the dependency, 33 value changes, and 22 identities left unchanged.
    const estimated = report.rows.filter((row) => row.valueEstimated);
    expect(estimated).toHaveLength(319);
    for (const row of estimated) {
      expect(row.feature).toBe('recommendations_v2');
      expect(row.after.source).toMatchObject({ kind: 'segment', segmentId: 105 });
      expect(row.after.variant).not.toBeNull();
    }
    expect(estimated.filter((row) => row.before.enabled === row.after.enabled)).toHaveLength(55);
  });

  it('yields one row per evaluated (identity, flag) pair', () => {
    const { rows } = buildFlipReport(runs.before, runs.after);

    expect(all.flags).toEqual(['holiday_banner', 'new_checkout', 'recommendations_v2']);
    expect(rows).toHaveLength(identities.length * all.flags.length);
    expect(new Set(rows.map((row) => `${row.identifier} ${row.feature}`)).size).toBe(rows.length);
    expect(rows.slice(0, 3).map((row) => [row.identifier, row.feature, row.featureId])).toEqual([
      ['user_00000', 'holiday_banner', 300003],
      ['user_00000', 'new_checkout', 300001],
      ['user_00000', 'recommendations_v2', 300005],
    ]);
  });

  it('gives the full evaluation and the evaluated flags alone the same report for those flags', () => {
    const options = { estimatedSplits: all.estimatedSplits };

    const full = buildFlipReport(runs.fullBefore, runs.fullAfter, options);
    const restricted = buildFlipReport(runs.before, runs.after, options);

    expect(restricted.flags).toEqual(
      full.flags.filter((impact) => all.flags.includes(impact.feature)),
    );
  });
});

describe('buildFlipReport', () => {
  const outcome = (enabled: boolean, value: FlagOutcome['value']): FlagOutcome => ({
    featureId: 7,
    enabled,
    value,
    variant: null,
    reason: 'DEFAULT',
    source: { kind: 'default' },
  });
  const run = (states: [boolean, FlagOutcome['value']][]): EvaluationRun =>
    states.map(([enabled, value], index) => ({
      identifier: `user_${index}`,
      identityId: index,
      flags: { banner: outcome(enabled, value) },
    }));

  it('sorts every change into its category', () => {
    const report = buildFlipReport(
      run([
        [false, 'a'],
        [true, 'a'],
        [true, 'a'],
        [false, 'a'],
        [true, 1],
        [true, 'a'],
      ]),
      run([
        [true, 'a'],
        [false, 'a'],
        [true, 'b'],
        [false, 'b'],
        [true, true],
        [true, 'a'],
      ]),
      { samplesPerCategory: 1 },
    );

    expect(report.rows.map((row) => row.change)).toEqual([
      'offToOn',
      'onToOff',
      'valueChanged',
      'valueChangedWhileOff',
      'valueChanged',
      null,
    ]);
    expect(report.flags[0]).toMatchObject({
      feature: 'banner',
      featureId: 7,
      evaluated: 6,
      changed: 5,
      unchanged: 1,
      counts: { offToOn: 1, onToOff: 1, valueChanged: 2, valueChangedWhileOff: 1 },
      transitions: [{ before: 'environment default', after: 'environment default', count: 5 }],
    });
    expect(report.flags[0]?.samples.valueChanged.map((row) => row.identifier)).toEqual(['user_2']);
  });

  it('refuses runs of different identities or flags', () => {
    const one = run([[true, 'a']]);

    expect(() =>
      buildFlipReport(
        one,
        run([
          [true, 'a'],
          [true, 'a'],
        ]),
      ),
    ).toThrow('The runs evaluate 1 and 2 identities.');
    expect(() =>
      buildFlipReport(
        one,
        one.map((evaluation) => ({ ...evaluation, identifier: 'other' })),
      ),
    ).toThrow('The runs evaluate different identities at position 0.');
    expect(() =>
      buildFlipReport(
        one,
        one.map((evaluation) => ({ ...evaluation, flags: {} })),
      ),
    ).toThrow('banner is not evaluated in both runs.');
  });
});

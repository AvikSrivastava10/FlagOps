/**
 * Compares two evaluations of the same identities, before and after a change, and explains every
 * change (architecture.md 10.1, 10.3 step 9). Its rows, one per (identity, evaluated flag) pair,
 * are what a promotion stores (D-050).
 */
import type { EvaluationRun, FlagOutcome, OutcomeSource } from './engine/types.js';

/**
 * How one identity's result changes:
 * - `offToOn`, `onToOff`: the flag's on/off state changes;
 * - `valueChanged`: on before and after, with a different value;
 * - `valueChangedWhileOff`: off before and after, with a different value, which code that reads
 *   a value without checking the flag, such as `getFeatureValue()`, still sees.
 */
export type FlipCategory = 'offToOn' | 'onToOff' | 'valueChanged' | 'valueChangedWhileOff';

export type ImpactRow = {
  feature: string;
  featureId: number;
  identifier: string;
  identityId: number;
  before: FlagOutcome;
  after: FlagOutcome;
  /** Null when the identity's result does not change. */
  change: FlipCategory | null;
  /**
   * The value after comes from a new split whose bucketing seed Flagsmith has not assigned yet,
   * so it is an estimate. The on/off result is exact either way.
   */
  valueEstimated: boolean;
};

/** Changed identities per "what decided the result before -> after". */
export type SourceTransition = { before: string; after: string; count: number };

export type FlagImpact = {
  feature: string;
  featureId: number;
  evaluated: number;
  unchanged: number;
  changed: number;
  counts: Record<FlipCategory, number>;
  /** Most common first. */
  transitions: SourceTransition[];
  /**
   * Identities whose value is estimated while their on/off result stays the same, so whether
   * they count as a value change is itself the estimate (architecture.md 10.3 step 9).
   */
  valueEstimated: number;
  /** The first changed rows of each category. */
  samples: Record<FlipCategory, ImpactRow[]>;
};

export type FlipReport = {
  /** Most changes first, then by flag name. */
  flags: FlagImpact[];
  /** One per (identity, evaluated flag) pair: identities in run order, then flags by name. */
  rows: ImpactRow[];
};

export type FlipReportOptions = {
  /** Flag name -> `estimatedSplitSegmentIds` of the applyFlagPut outcome that changed the flag. */
  estimatedSplits?: Readonly<Record<string, readonly number[]>>;
  /** 3 by default. */
  samplesPerCategory?: number;
};

/** `before` and `after` must evaluate the same identities, in the same order, for the same flags. */
export function buildFlipReport(
  before: EvaluationRun,
  after: EvaluationRun,
  options: FlipReportOptions = {},
): FlipReport {
  if (before.length !== after.length) {
    throw new Error(`The runs evaluate ${before.length} and ${after.length} identities.`);
  }
  const samplesPerCategory = options.samplesPerCategory ?? 3;
  const rows: ImpactRow[] = [];
  const impacts = new Map<string, FlagImpact>();
  before.forEach((was, index) => {
    const now = after[index];
    if (now?.identifier !== was.identifier) {
      throw new Error(`The runs evaluate different identities at position ${index}.`);
    }
    for (const feature of Object.keys(was.flags).sort()) {
      const previous = was.flags[feature];
      const next = now.flags[feature];
      if (previous === undefined || next === undefined) {
        throw new Error(`${feature} is not evaluated in both runs.`);
      }
      const row: ImpactRow = {
        feature,
        featureId: next.featureId,
        identifier: was.identifier,
        identityId: was.identityId,
        before: previous,
        after: next,
        change: categorise(previous, next),
        valueEstimated: isEstimated(next, options.estimatedSplits?.[feature] ?? []),
      };
      rows.push(row);
      let impact = impacts.get(feature);
      if (impact === undefined) {
        impact = emptyImpact(feature, next.featureId);
        impacts.set(feature, impact);
      }
      tally(impact, row, samplesPerCategory);
    }
    if (Object.keys(now.flags).length !== Object.keys(was.flags).length) {
      throw new Error(`The runs evaluate different flags for ${was.identifier}.`);
    }
  });
  const flags = [...impacts.values()].sort(
    (a, b) => b.changed - a.changed || (a.feature < b.feature ? -1 : 1),
  );
  for (const impact of flags) {
    impact.transitions.sort((a, b) => b.count - a.count);
  }
  return { flags, rows };
}

export function describeSource(source: OutcomeSource): string {
  switch (source.kind) {
    case 'default':
      return 'environment default';
    case 'identity_override':
      return 'identity override';
    case 'segment':
      return `segment ${source.segmentName} #${source.segmentId}`;
  }
}

function categorise(before: FlagOutcome, after: FlagOutcome): FlipCategory | null {
  if (before.enabled !== after.enabled) {
    return after.enabled ? 'offToOn' : 'onToOff';
  }
  // Values are JSON scalars, and 1 and true differ for the SDK's caller too.
  if (before.value === after.value) {
    return null;
  }
  return after.enabled ? 'valueChanged' : 'valueChangedWhileOff';
}

function isEstimated(outcome: FlagOutcome, splitSegmentIds: readonly number[]): boolean {
  return (
    outcome.source.kind === 'segment' &&
    splitSegmentIds.includes(outcome.source.segmentId) &&
    outcome.variant !== null
  );
}

function emptyImpact(feature: string, featureId: number): FlagImpact {
  return {
    feature,
    featureId,
    evaluated: 0,
    unchanged: 0,
    changed: 0,
    counts: { offToOn: 0, onToOff: 0, valueChanged: 0, valueChangedWhileOff: 0 },
    transitions: [],
    valueEstimated: 0,
    samples: { offToOn: [], onToOff: [], valueChanged: [], valueChangedWhileOff: [] },
  };
}

function tally(impact: FlagImpact, row: ImpactRow, samplesPerCategory: number): void {
  impact.evaluated++;
  if (row.valueEstimated && row.before.enabled === row.after.enabled) {
    impact.valueEstimated++;
  }
  if (row.change === null) {
    impact.unchanged++;
    return;
  }
  impact.changed++;
  impact.counts[row.change]++;
  const before = describeSource(row.before.source);
  const after = describeSource(row.after.source);
  const transition = impact.transitions.find(
    (known) => known.before === before && known.after === after,
  );
  if (transition === undefined) {
    impact.transitions.push({ before, after, count: 1 });
  } else {
    transition.count++;
  }
  const samples = impact.samples[row.change];
  if (samples.length < samplesPerCategory) {
    samples.push(row);
  }
}

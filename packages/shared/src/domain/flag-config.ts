/**
 * The normalised configuration of one flag in one environment (architecture.md 5.1). Comparisons,
 * stage rules and writes all use this shape, whichever Flagsmith API it was read from.
 */

/** A flag value, typed as Flagsmith serves it. Floats are stored as strings and stay strings. */
export type FlagValue = string | number | boolean | null;

/** The weight (0-100) of one multivariate option. Lists are sorted by `optionId`. */
export type Variant = { optionId: number; weight: number };

export type FlagState = { enabled: boolean; value: FlagValue; variants: Variant[] };

/**
 * What kind of segment an override targets:
 * - `user`: listed by the segments API and managed by nobody;
 * - `managed`: listed, and managed by another Flagsmith feature (cohort, experiment, release pipeline);
 * - `dependency`: the system segment Flagsmith writes for a flag dependency;
 * - `system`: any other segment missing from the segments list.
 */
export type SegmentKind =
  | { kind: 'user' }
  | { kind: 'managed'; managedBy: string }
  | { kind: 'dependency'; prerequisite: string }
  | { kind: 'system' };

export type SegmentOverride = FlagState & {
  segmentId: number;
  priority: number;
  segment: SegmentKind;
};

export type IdentityOverride = { identifier: string; enabled: boolean; value: FlagValue };

export type FlagConfig = {
  environmentDefault: FlagState;
  /** Sorted by priority, then segment ID. */
  segmentOverrides: SegmentOverride[];
  /** The overrides, sorted by identifier, when the environment document lists them; else their count. */
  identityOverrides: IdentityOverride[] | { count: number };
};

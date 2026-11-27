/**
 * The plain data the impact engine reads and returns (architecture.md 10.1). Callers convert
 * their own types into these at the boundary, so nothing here depends on another module.
 *
 * The document types mirror `GET /api/v1/environments/{api_key}/document/` on Flagsmith 2.295.2
 * (built by `api/util/mappers/engine.py`). Only the fields the engine reads or writes are typed;
 * a copy made by the engine keeps every other field of the document.
 */

/** A flag value as the document serves it. */
export type FlagValue = string | number | boolean | null;

export type FeatureRef = {
  id: number;
  name: string;
  /** `STANDARD` or `MULTIVARIATE`. */
  type: string;
};

export type MultivariateOptionDoc = {
  /** `MultivariateFeatureOption.id`: the same in every environment, and the `id` of a PUT variant. */
  id: number | null;
  key?: string | null;
  value: FlagValue;
};

export type MultivariateValueDoc = {
  /** Row ID of the weight. Flagsmith allocates variants in row ID order. */
  id: number | null;
  multivariate_feature_option: MultivariateOptionDoc;
  mv_fs_value_uuid: string;
  /** The variant's weight, a percentage from 0 to 100. */
  percentage_allocation: number;
};

export type FeatureStateDoc = {
  /** The multivariate bucketing seed (`FeatureState.mv_hashing_seed`), not always the row ID. */
  django_id: number | null;
  enabled: boolean;
  feature: FeatureRef;
  /** Set on segment overrides only. The lowest priority wins. */
  feature_segment: { priority: number | null } | null;
  /** The value, or the control value of a multivariate flag. */
  feature_state_value: FlagValue;
  featurestate_uuid: string;
  multivariate_feature_state_values: MultivariateValueDoc[];
};

export type SegmentConditionDoc = {
  operator: string;
  /** A trait name, or a JSONPath into the evaluation context such as `$.identity.identifier`. */
  property_: string | null;
  value: string | null;
};

export type SegmentRuleDoc = {
  type: 'ALL' | 'ANY' | 'NONE';
  rules: SegmentRuleDoc[];
  conditions: SegmentConditionDoc[];
};

export type SegmentDoc = {
  id: number;
  name: string;
  rules: SegmentRuleDoc[];
  /** This environment's overrides on the segment, at most one per flag. */
  feature_states: FeatureStateDoc[];
};

export type IdentityOverridesDoc = {
  identifier: string;
  identity_features: FeatureStateDoc[];
};

export type EnvironmentDocument = {
  /** The environment's client key. Part of the composite hashing key, and `$.environment.key`. */
  api_key: string;
  name: string | null;
  use_identity_composite_key_for_hashing: boolean;
  /** Overrides the project's setting when not null. */
  hide_disabled_flags: boolean | null;
  /** The environment default of every flag. */
  feature_states: FeatureStateDoc[];
  /** Empty when the environment's `use_identity_overrides_in_local_eval` is off. */
  identity_overrides: IdentityOverridesDoc[];
  project: {
    hide_disabled_flags: boolean;
    /** Includes system (flag dependency) segments, which the document does not mark. */
    segments: SegmentDoc[];
  };
};

/** A trait value as the identity cache holds it. */
export type TraitValue = string | number | boolean | null;

/** `Trait.value_type`, as the Admin API's traits endpoint returns it. */
export type TraitValueType = 'int' | 'unicode' | 'bool' | 'float';

export type IdentityTrait = {
  value: TraitValue;
  /** Needed because JavaScript reads a whole-number float such as 3.0 as an integer (R13). */
  valueType: TraitValueType;
};

/** An identity stored in Flagsmith, with its traits. */
export type PreviewIdentity = {
  identifier: string;
  /** `Identity.id`. Flagsmith hashes by it when `use_identity_composite_key_for_hashing` is off. */
  identityId: number;
  traits: Readonly<Record<string, IdentityTrait>>;
};

/** Which part of the document decided a flag's result. */
export type OutcomeSource =
  | { kind: 'default' }
  | { kind: 'segment'; segmentId: number; segmentName: string; priority: number | null }
  | { kind: 'identity_override' };

/** One flag's result for one identity, as Flagsmith's remote evaluation would serve it. */
export type FlagOutcome = {
  featureId: number;
  enabled: boolean;
  /** Null for a disabled flag when the environment hides disabled flags: the SDK never gets it. */
  value: FlagValue;
  /**
   * The variant key, or `control` when the split put the identity outside every variant. Null
   * without a split, for a variant without a key, and when the value is hidden.
   */
  variant: string | null;
  /**
   * The multivariate split of the state that decided the result chose the value, one of its
   * variants or its control value, so that state's bucketing seed decided it. False when the
   * value is hidden.
   */
  fromSplit: boolean;
  /** The engine's reason, e.g. `DEFAULT`, `TARGETING_MATCH; segment=beta` or `SPLIT; weight=50`. */
  reason: string;
  source: OutcomeSource;
};

export type IdentityEvaluation = {
  identifier: string;
  identityId: number;
  /** Flag name -> result, for every flag the profile evaluates. */
  flags: Readonly<Record<string, FlagOutcome>>;
};

/** The results of one document for a list of identities, in the order of that list. */
export type EvaluationRun = readonly IdentityEvaluation[];

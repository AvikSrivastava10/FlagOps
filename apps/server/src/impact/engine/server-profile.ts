// Ported from Flagsmith's api/evaluation/mappers.py (2.295.2, BSD-3-Clause; see THIRD_PARTY_NOTICES.md).
/**
 * The server profile (architecture.md 10.1, D-040): the Node SDK's engine, fed a context built the
 * way the Core API builds it for remote evaluation, from the environment document instead of
 * database rows. Remote evaluation is what the browser SDK and a remote-mode Node SDK receive.
 *
 * Where it differs from the SDK's own document mapper, it follows the server:
 * - the hashing key is the composite key or `Identity.id`, per the environment setting (R12);
 * - each identity gets one `identity_overrides` segment with only its own overrides (R9);
 * - variants are prioritised by position in row ID order, and the bucketing seed is `django_id`.
 * It also feeds the engine its inputs the way the Python engine reads them: numeric-looking trait
 * strings become numbers (R4), REGEX patterns are anchored like `re.match` (R1), and IN values
 * arrive split as Python splits them (R6). Every feature context carries provenance metadata,
 * which the engine hands back, so each result names the segment or override that decided it.
 */
import { FlagOpsError } from '@flagops/shared';
import {
  loadFlagsmithEngine,
  type EngineCondition,
  type EngineContext,
  type EngineFeatureContext,
  type EngineFlagResult,
  type EngineRule,
  type EngineSegmentContext,
  type FlagsmithEngine,
} from './flagsmith-internals.js';
import type {
  EnvironmentDocument,
  EvaluationRun,
  FeatureStateDoc,
  FlagOutcome,
  IdentityEvaluation,
  MultivariateValueDoc,
  OutcomeSource,
  PreviewIdentity,
  SegmentRuleDoc,
  TraitValue,
} from './types.js';

/** What each feature context carries and the engine returns on the result that context decides. */
type Provenance = { featureId: number; source: OutcomeSource };

const IDENTITY_OVERRIDES = 'identity_overrides';

export type ServerProfile = {
  readonly environmentKey: string;
  readonly useCompositeKeyForHashing: boolean;
  /** The environment's `hide_disabled_flags`, or the project's when the environment's is null. */
  readonly hideDisabledFlags: boolean;
  /** The flags this profile evaluates, sorted by name. */
  readonly flags: readonly string[];
  readonly engine: FlagsmithEngine;
  /** The context without an identity. Never changed after preparation. */
  readonly context: EngineContext<Provenance>;
  /** Identifier -> the `identity_overrides` segment of that identity. */
  readonly identityOverrides: ReadonlyMap<string, EngineSegmentContext<Provenance>>;
};

export type ServerProfileOptions = {
  /**
   * Evaluate only these flags, as `evaluatedFlags` returns them. Their results are the same as in
   * a full evaluation, and a preview gets them two to three times faster. Every flag by default.
   */
  flags?: Iterable<string>;
};

/** map_environment_to_evaluation_context, for one document and any number of identities. */
export async function prepareServerProfile(
  document: EnvironmentDocument,
  options: ServerProfileOptions = {},
): Promise<ServerProfile> {
  const engine = await loadFlagsmithEngine();
  const only = options.flags === undefined ? undefined : new Set(options.flags);
  const isEvaluated = (state: FeatureStateDoc) =>
    only === undefined || only.has(state.feature.name);

  const features: Record<string, EngineFeatureContext<Provenance>> = {};
  for (const state of document.feature_states.filter(isEvaluated)) {
    if (state.feature.name in Object.prototype) {
      // The engine keeps results in plain objects, so a flag named "constructor" makes it throw.
      throw new FlagOpsError(
        'internal_error',
        `The impact preview cannot evaluate the flag ${state.feature.name}: the evaluation engine of @flagsmith/nodejs ${engine.version} fails on flags named like JavaScript object members.`,
        { details: { feature: state.feature.name } },
      );
    }
    features[state.feature.name] = featureContext(state, { kind: 'default' });
  }
  const segments: Record<string, EngineSegmentContext<Provenance>> = {};
  for (const segment of document.project.segments) {
    const overrides = segment.feature_states.filter(isEvaluated).map((state) =>
      featureContext(state, {
        kind: 'segment',
        segmentId: segment.id,
        segmentName: segment.name,
        priority: state.feature_segment?.priority ?? null,
      }),
    );
    // A segment that overrides no evaluated flag cannot change a result.
    if (overrides.length > 0) {
      const key = String(segment.id);
      segments[key] = { key, name: segment.name, rules: mapRules(segment.rules), overrides };
    }
  }
  const identityOverrides = new Map<string, EngineSegmentContext<Provenance>>();
  for (const identity of document.identity_overrides) {
    const overrides = identity.identity_features
      .filter(isEvaluated)
      .map((state) =>
        featureContext(state, { kind: 'identity_override' }, Number.NEGATIVE_INFINITY),
      );
    if (overrides.length > 0) {
      identityOverrides.set(identity.identifier, identityOverridesSegment(overrides));
    }
  }
  return {
    environmentKey: document.api_key,
    useCompositeKeyForHashing: document.use_identity_composite_key_for_hashing,
    hideDisabledFlags: document.hide_disabled_flags ?? document.project.hide_disabled_flags,
    flags: Object.keys(features).sort(),
    engine,
    context: {
      environment: { key: document.api_key, name: document.name ?? '' },
      features,
      segments,
    },
    identityOverrides,
  };
}

/** What Flagsmith's remote evaluation serves this identity, for every flag of the profile. */
export function evaluateIdentity(
  profile: ServerProfile,
  identity: PreviewIdentity,
): IdentityEvaluation {
  // Without a prototype, a trait named like an object member ("constructor", "__proto__") is
  // stored and looked up like any other, as in the Python engine's dict.
  const traits = Object.create(null) as Record<string, TraitValue>;
  for (const [key, trait] of Object.entries(identity.traits)) {
    traits[key] = coerceTraitValue(trait.value);
  }
  const overrides = profile.identityOverrides.get(identity.identifier);
  const result = profile.engine.getEvaluationResult({
    ...profile.context,
    ...(overrides && {
      segments: { ...profile.context.segments, [IDENTITY_OVERRIDES]: overrides },
    }),
    identity: { identifier: identity.identifier, key: serverHashKey(profile, identity), traits },
  });
  const flags: Record<string, FlagOutcome> = {};
  for (const flag of Object.values(result.flags)) {
    flags[flag.name] = outcomeOf(flag, profile.hideDisabledFlags);
  }
  return { identifier: identity.identifier, identityId: identity.identityId, flags };
}

export function evaluateIdentities(
  profile: ServerProfile,
  identities: readonly PreviewIdentity[],
): EvaluationRun {
  return identities.map((identity) => evaluateIdentity(profile, identity));
}

/** Identity.get_hash_key, as the server calls it for remote evaluation (R12). */
export function serverHashKey(
  profile: Pick<ServerProfile, 'environmentKey' | 'useCompositeKeyForHashing'>,
  identity: Pick<PreviewIdentity, 'identifier' | 'identityId'>,
): string {
  return profile.useCompositeKeyForHashing
    ? `${profile.environmentKey}_${identity.identifier}`
    : String(identity.identityId);
}

/**
 * The flags a change to the `changed` flags can affect, plus the flags those need, sorted
 * (architecture.md 10.3 step 4):
 * - the changed flags;
 * - dependents: every flag overridden by a segment that reads an evaluated flag through
 *   `$.flags`, transitively;
 * - prerequisites: every flag that the segments of evaluated flags read, so `$.flags` resolves.
 * Pass the documents before and after the change, because a PUT can add or remove overrides.
 */
export function evaluatedFlags(
  documents: readonly EnvironmentDocument[],
  changed: Iterable<string>,
): string[] {
  const segments = documents
    .flatMap((document) => document.project.segments)
    .map((segment) => ({
      reads: [...flagsReadBy(segment.rules)],
      overrides: segment.feature_states.map((state) => state.feature.name),
    }));
  const evaluated = new Set(changed);
  const addUntilStable = (select: (segment: (typeof segments)[number]) => string[]) => {
    for (let grew = true; grew;) {
      grew = false;
      for (const name of segments.flatMap(select)) {
        if (!evaluated.has(name)) {
          evaluated.add(name);
          grew = true;
        }
      }
    }
  };
  addUntilStable((segment) =>
    segment.reads.some((name) => evaluated.has(name)) ? segment.overrides : [],
  );
  addUntilStable((segment) =>
    segment.overrides.some((name) => evaluated.has(name)) ? segment.reads : [],
  );
  return [...evaluated].sort();
}

const FLAG_PROPERTY = /^\$\.flags(?:\.([^.[\]]+)|\[(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\])/;

/**
 * The flags a segment's conditions read through `$.flags`, as in `$.flags["name"].enabled`, the
 * shape Flagsmith writes for a flag dependency (features/dependencies/mappers.py).
 */
export function flagsReadBy(rules: readonly SegmentRuleDoc[]): Set<string> {
  const names = new Set<string>();
  const visit = (rule: SegmentRuleDoc): void => {
    for (const condition of rule.conditions) {
      const match = FLAG_PROPERTY.exec(condition.property_ ?? '');
      if (match) {
        const [, member, doubleQuoted, singleQuoted] = match;
        const name =
          member ?? (doubleQuoted === undefined ? singleQuoted : unescapeJson(doubleQuoted));
        if (name !== undefined) {
          names.add(name);
        }
      }
    }
    rule.rules.forEach(visit);
  };
  rules.forEach(visit);
  return names;
}

function unescapeJson(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text;
  }
}

/**
 * The server matches REGEX with Python's `re.match`, which matches only at the start of the
 * string, while the Node engine searches anywhere (R1). The non-capturing group keeps group
 * numbers, and an empty pattern still matches everything, as `re.compile('').match()` does.
 */
export function anchorLikePythonMatch(pattern: string): string {
  return `^(?:${pattern})`;
}

/**
 * `_get_in_values` (flag_engine/segments/evaluator.py): a value starting with "[" is a JSON list
 * whose elements Python turns into strings, and anything else a comma-separated list (R6).
 * Handing the engine the list spares it a JSON.parse that throws on every comma-separated value.
 * Lists holding anything but strings and integers stay as they are: their Python `str()` forms
 * ("True", "None", "1.0") cannot be rebuilt from parsed JSON, so the divergence lint marks them.
 */
export function inValuesLikePython(value: string): string | string[] {
  if (!value.startsWith('[')) {
    return value.split(',');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value.split(',');
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === 'string' || Number.isSafeInteger(item))
  ) {
    return value;
  }
  return parsed.map(String);
}

/**
 * The number Python reads a string as before it compares it (`_map_string_value_to_context_value`
 * in flag_engine/context/mappers.py), if any.
 */
export function pythonNumberKind(text: string): 'integer' | 'decimal' | undefined {
  if (/^-?[0-9]+$/.test(text)) {
    return 'integer';
  }
  return /^-?[0-9]+\.[0-9]+$/.test(text) ? 'decimal' : undefined;
}

/**
 * `map_any_value_to_context_value` (flag_engine/context/mappers.py): Python turns numeric-looking
 * trait strings into numbers before every operator (R4). An integer beyond JavaScript's safe
 * range stays a string, because the conversion would change its digits.
 */
export function coerceTraitValue(value: TraitValue): TraitValue {
  if (typeof value !== 'string') {
    return value;
  }
  switch (pythonNumberKind(value)) {
    case 'integer': {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : value;
    }
    case 'decimal':
      return Number(value);
    case undefined:
      return value;
  }
}

/** map_feature_state_to_feature_context. The document's `django_id` is the bucketing seed. */
function featureContext(
  state: FeatureStateDoc,
  source: OutcomeSource,
  priority?: number,
): EngineFeatureContext<Provenance> {
  const variants = [...state.multivariate_feature_state_values]
    .sort(byRowId)
    .map(({ multivariate_feature_option: option, percentage_allocation: weight }, index) => ({
      value: option.value,
      weight,
      priority: index,
      ...(option.key !== undefined && option.key !== null && { key: option.key }),
    }));
  if (variants.length > 0 && state.django_id === null) {
    // Without the seed, every identity's variant is unknown (architecture.md 6.5, 11.2).
    throw new FlagOpsError(
      'flagsmith_unexpected_response',
      `The environment document has no django_id (the bucketing seed) on a multivariate state of ${state.feature.name}, so the preview cannot tell which variant each identity gets.`,
      { details: { feature: state.feature.name, source } },
    );
  }
  const contextPriority = priority ?? state.feature_segment?.priority ?? undefined;
  return {
    key: String(state.django_id ?? state.featurestate_uuid),
    name: state.feature.name,
    enabled: state.enabled,
    value: state.feature_state_value,
    metadata: { featureId: state.feature.id, source },
    ...(variants.length > 0 && { variants }),
    ...(contextPriority !== undefined && { priority: contextPriority }),
  };
}

/** Rows without an ID cannot occur in a served document; they would sort last. */
function byRowId(a: MultivariateValueDoc, b: MultivariateValueDoc): number {
  return (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER);
}

/** map_identity_overrides_to_segment_context: a segment that matches the evaluated identity. */
function identityOverridesSegment(
  overrides: EngineFeatureContext<Provenance>[],
): EngineSegmentContext<Provenance> {
  return {
    key: IDENTITY_OVERRIDES,
    name: IDENTITY_OVERRIDES,
    rules: [
      {
        type: 'ALL',
        conditions: [{ property: '$.identity.key', operator: 'IS_SET', value: '' }],
        rules: [],
      },
    ],
    overrides,
  };
}

/** map_rule_to_segment_rule and map_condition_to_segment_condition. */
function mapRules(rules: readonly SegmentRuleDoc[]): EngineRule[] {
  return rules.map((rule) => ({
    type: rule.type,
    conditions: rule.conditions.map((condition): EngineCondition => ({
      property: condition.property_ ?? '',
      operator: condition.operator,
      value: conditionValue(condition.operator, condition.value ?? ''),
    })),
    rules: mapRules(rule.rules),
  }));
}

function conditionValue(operator: string, value: string): string | string[] {
  switch (operator) {
    case 'REGEX':
      return anchorLikePythonMatch(value);
    case 'IN':
      return inValuesLikePython(value);
    default:
      return value;
  }
}

function outcomeOf(flag: EngineFlagResult<Provenance>, hideDisabledFlags: boolean): FlagOutcome {
  if (flag.metadata === undefined) {
    throw new Error(`The engine returned ${flag.name} without the metadata its context carried.`);
  }
  // With hide_disabled_flags, Flagsmith leaves disabled flags out of SDK responses, so the SDK
  // falls back to a missing flag's value (evaluation/services.py `_hide_flags`).
  const hidden = hideDisabledFlags && !flag.enabled;
  return {
    featureId: flag.metadata.featureId,
    enabled: flag.enabled,
    value: hidden ? null : flag.value,
    variant: hidden ? null : flag.variant,
    reason: flag.reason,
    source: flag.metadata.source,
  };
}

// Ported from Flagsmith's api/features/future/services.py, update_flag with replace=True (2.295.2, BSD-3-Clause; see THIRD_PARTY_NOTICES.md).
/**
 * Applies the body of a declarative `PUT /api/__future__/environments/{key}/features/{id}/` to a
 * copy of an environment document, so the proposed document can be evaluated before anything is
 * written (architecture.md 10.1, 10.3 step 3). It mirrors the server's validation too
 * (features/future/serializers.py and services.py): a body it rejects is one Flagsmith would
 * reject with the same status and message, writing nothing.
 *
 * Four checks need more than the document, so the caller makes them:
 * - change requests (409);
 * - permissions;
 * - the segment-override limit, which Flagsmith applies to Edge deployments only;
 * - circular dependencies (400 `circular_dependency`): for every override the PUT creates on a
 *   segment that reads `$.flags`, Flagsmith refuses the body if a flag would end up depending on
 *   itself. It counts scheduled overrides and the segment's overrides in other environments,
 *   which no document carries, so this refusal may only appear when the PUT is sent.
 *
 * Where Flagsmith reports several problems at once, the rejection names the first.
 */
import type {
  EnvironmentDocument,
  FeatureRef,
  FeatureStateDoc,
  FlagValue,
  MultivariateOptionDoc,
  SegmentDoc,
  SegmentRuleDoc,
} from './engine/types.js';

// The request shapes of features/future/types.py.

export type FlagValueBody = { type: 'string' | 'integer' | 'boolean'; value: string };

export type VariantBody = {
  /** `MultivariateFeatureOption.id`, the same in every environment of the project. */
  id: number;
  /** A percentage from 0 to 100. */
  weight: number;
};

export type FlagStateBody = {
  enabled?: boolean;
  value?: FlagValueBody | null;
  variants?: readonly VariantBody[];
};

export type SegmentOverrideBody = FlagStateBody & { segment: { id: number }; priority?: number };

export type FlagPutBody = {
  environment_default?: FlagStateBody;
  segment_overrides?: readonly SegmentOverrideBody[];
};

/**
 * A segment as `GET /api/v1/projects/{id}/segments/?include_feature_specific=true` lists it, with
 * its rules in the document's shape. The list never includes system segments, so a segment in
 * the document that the list lacks is one.
 */
export type ProjectSegment = { id: number; name: string; rules: SegmentRuleDoc[] };

export type PutRejection = {
  /** The status Flagsmith would answer with. */
  status: 400 | 404 | 409;
  message: string;
  /** Flagsmith's error code, where its answer carries one. */
  code?: 'feature_not_found' | 'system_segment_modification';
  /** The part of the body the message is about, such as `segment_overrides[1].priority`. */
  field?: string;
};

export type AppliedPut = {
  accepted: true;
  /** A copy of the document with the change applied. */
  document: EnvironmentDocument;
  feature: FeatureRef;
  createdSegmentIds: number[];
  updatedSegmentIds: number[];
  deletedSegmentIds: number[];
  /**
   * New overrides that split between variants. Their bucketing seed is the ID of a row Flagsmith
   * has not created yet, so which variant each identity gets is an estimate. The share per
   * variant and every on/off result are exact.
   */
  estimatedSplitSegmentIds: number[];
};

export type PutOutcome = AppliedPut | { accepted: false; rejection: PutRejection };

/**
 * Applies `body` to a copy of `document` for the flag `featureId`. `segments` is the project's
 * segments list. The document passed in is never changed.
 */
export function applyFlagPut(
  document: EnvironmentDocument,
  featureId: number,
  body: FlagPutBody,
  segments: readonly ProjectSegment[],
): PutOutcome {
  try {
    return apply(
      document,
      featureId,
      body,
      new Map(segments.map((segment) => [segment.id, segment])),
    );
  } catch (error) {
    if (error instanceof Rejected) {
      return { accepted: false, rejection: error.rejection };
    }
    throw error;
  }
}

/** Thrown inside this module only, and returned as the outcome. */
class Rejected extends Error {
  readonly rejection: PutRejection;

  constructor(rejection: PutRejection) {
    super(rejection.message);
    this.name = 'Rejected';
    this.rejection = rejection;
  }
}

function reject(
  status: PutRejection['status'],
  message: string,
  details: Pick<PutRejection, 'code' | 'field'> = {},
): never {
  throw new Rejected({ status, message, ...details });
}

type Lookups = {
  listed: ReadonlyMap<number, ProjectSegment>;
  options: ReadonlyMap<number, MultivariateOptionDoc>;
  newRowId: () => number;
};

function apply(
  input: EnvironmentDocument,
  featureId: number,
  body: FlagPutBody,
  listed: ReadonlyMap<number, ProjectSegment>,
): AppliedPut {
  const document = structuredClone(input);
  const environmentDefault = document.feature_states.find(
    (state) => state.feature.id === featureId,
  );
  if (environmentDefault === undefined) {
    reject(404, `Feature ID '${featureId}' does not exist in the project.`, {
      code: 'feature_not_found',
    });
  }
  const lookups: Lookups = {
    listed,
    options: variantOptions(document, featureId),
    newRowId: rowIdAllocator(document),
  };
  validate(document, environmentDefault.feature, body, lookups);

  const outcome: AppliedPut = {
    accepted: true,
    document,
    feature: { ...environmentDefault.feature },
    createdSegmentIds: [],
    updatedSegmentIds: [],
    deletedSegmentIds: [],
    estimatedSplitSegmentIds: [],
  };
  // writes_nothing: a body without parts changes nothing.
  if (body.environment_default === undefined && body.segment_overrides === undefined) {
    return outcome;
  }

  // _write_environment_default: under PUT, an omitted `enabled` becomes false and an omitted
  // value is cleared.
  const defaultChange = body.environment_default;
  if (defaultChange !== undefined) {
    environmentDefault.enabled = defaultChange.enabled ?? false;
    environmentDefault.feature_state_value = typedValue(
      defaultChange.value ?? null,
      'environment_default.value',
    );
    if (defaultChange.variants !== undefined) {
      writeVariants(environmentDefault, defaultChange.variants, lookups);
    }
    followEnvironmentDefault(document, environmentDefault);
  }
  if (body.segment_overrides !== undefined) {
    writeSegmentOverrides(document, environmentDefault, body.segment_overrides, lookups, outcome);
  }
  return outcome;
}

/** The serializer checks (features/future/serializers.py), which run before anything is written. */
function validate(
  document: EnvironmentDocument,
  feature: FeatureRef,
  body: FlagPutBody,
  lookups: Lookups,
): void {
  if (body.environment_default !== undefined) {
    validateFlagState(body.environment_default, 'environment_default', feature, lookups);
    // EnvironmentDefaultSerializer.validate: replacing a multivariate default needs its weights.
    if (feature.type === 'MULTIVARIATE' && body.environment_default.variants === undefined) {
      reject(400, "Must include all feature's variants.", {
        field: 'environment_default.variants',
      });
    }
  }
  const inDocument = new Set(document.project.segments.map((segment) => segment.id));
  const seen = new Set<number>();
  body.segment_overrides?.forEach((override, index) => {
    const field = `segment_overrides[${index}]`;
    validateFlagState(override, field, feature, lookups);
    const segmentId = override.segment.id;
    // Flagsmith finds every live segment of the project here, system segments included.
    if (!lookups.listed.has(segmentId) && !inDocument.has(segmentId)) {
      reject(400, 'Segment not found.', { field: `${field}.segment.id` });
    }
    if (override.priority !== undefined) {
      if (!Number.isInteger(override.priority)) {
        reject(400, 'A valid integer is required.', { field: `${field}.priority` });
      }
      if (override.priority < 0) {
        reject(400, 'Ensure this value is greater than or equal to 0.', {
          field: `${field}.priority`,
        });
      }
    }
  });
  for (const override of body.segment_overrides ?? []) {
    if (seen.has(override.segment.id)) {
      reject(400, `Duplicate segment: ${override.segment.id}.`, { field: 'segment_overrides' });
    }
    seen.add(override.segment.id);
  }
}

function validateFlagState(
  state: FlagStateBody,
  field: string,
  feature: FeatureRef,
  lookups: Lookups,
): void {
  if (state.value !== undefined && state.value !== null) {
    typedValue(state.value, `${field}.value`);
  }
  if (state.variants !== undefined) {
    checkVariants(feature, state.variants, lookups.options, `${field}.variants`);
  }
}

/** VariantSerializer, then check_variants (features/future/services.py). */
function checkVariants(
  feature: FeatureRef,
  variants: readonly VariantBody[],
  options: ReadonlyMap<number, MultivariateOptionDoc>,
  field: string,
): void {
  variants.forEach(({ weight }, index) => {
    if (weight < 0) {
      reject(400, 'Ensure this value is greater than or equal to 0.', {
        field: `${field}[${index}].weight`,
      });
    }
    if (weight > 100) {
      reject(400, 'Ensure this value is less than or equal to 100.', {
        field: `${field}[${index}].weight`,
      });
    }
  });
  if (feature.type !== 'MULTIVARIATE') {
    reject(400, 'Feature is not multivariate.', { field });
  }
  const ids = variants.map((variant) => variant.id);
  const [duplicate] = ids.filter((id, index) => ids.indexOf(id) !== index).sort(numerically);
  if (duplicate !== undefined) {
    reject(400, `Duplicate variant: ${duplicate}.`, { field });
  }
  const [unknown] = ids.filter((id) => !options.has(id)).sort(numerically);
  if (unknown !== undefined) {
    reject(400, `Variant not found: ${unknown}.`, { field });
  }
  if ([...options.keys()].some((id) => !ids.includes(id))) {
    reject(400, "Must include all feature's variants.", { field });
  }
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total > 100) {
    // Weights are Python floats, so Flagsmith prints 110 as 110.0.
    const printed = Number.isInteger(total) ? total.toFixed(1) : String(total);
    reject(400, `Total weight must not exceed 100, got ${printed}.`, { field });
  }
}

/** FeatureStateValue.set_value (features/feature_states/models.py), with its messages. */
function typedValue(body: FlagValueBody | null, field: string): FlagValue {
  if (body === null) {
    return null;
  }
  const type: string = body.type;
  switch (type) {
    case 'string':
      return body.value;
    case 'integer': {
      // Python's int() accepts surrounding whitespace, a sign and underscores between digits.
      if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/.test(body.value)) {
        reject(400, `'${body.value}' is not a valid integer`, { field });
      }
      // Adding 0 turns -0 into 0, as int('-0') does.
      const parsed = Number(body.value.replace(/[\s_]/g, '')) + 0;
      // The column is a Postgres integer, which stores -2147483648 to 2147483647.
      if (parsed < -(2 ** 31) || parsed > 2 ** 31 - 1) {
        reject(400, `'${body.value}' is out of range for a Flagsmith integer value`, { field });
      }
      return parsed;
    }
    case 'boolean': {
      const lowered = body.value.toLowerCase();
      if (lowered !== 'true' && lowered !== 'false') {
        reject(400, `'${body.value}' is not a valid boolean (use 'true' or 'false')`, { field });
      }
      return lowered === 'true';
    }
    default:
      return reject(400, `"${type}" is not a valid choice.`, { field: `${field}.type` });
  }
}

/** _write_segment_overrides with replace=True. */
function writeSegmentOverrides(
  document: EnvironmentDocument,
  environmentDefault: FeatureStateDoc,
  changes: readonly SegmentOverrideBody[],
  lookups: Lookups,
  outcome: AppliedPut,
): void {
  const featureId = environmentDefault.feature.id;
  const overrides = overridesBySegmentId(document, featureId);
  const changedIds = new Set(changes.map((change) => change.segment.id));
  // The segments list leaves system segments out, and the validation found every segment.
  const isSystem = (segmentId: number) => !lookups.listed.has(segmentId);
  for (const segmentId of changedIds) {
    if (isSystem(segmentId)) {
      rejectSystemSegment(document, segmentId);
    }
  }

  // A PUT deletes the overrides it omits, except those on system segments.
  outcome.deletedSegmentIds = [...overrides.keys()]
    .filter((segmentId) => !changedIds.has(segmentId) && !isSystem(segmentId))
    .sort(numerically);
  for (const segmentId of outcome.deletedSegmentIds) {
    const segment = overrides.get(segmentId)?.segment;
    if (segment !== undefined) {
      segment.feature_states = segment.feature_states.filter(
        (state) => state.feature.id !== featureId,
      );
    }
  }
  // The system overrides that stay hold their priorities.
  const held = new Set<number>();
  for (const [segmentId, { state }] of overrides) {
    const priority = state.feature_segment?.priority;
    if (isSystem(segmentId) && priority !== undefined && priority !== null) {
      held.add(priority);
    }
  }

  changes.forEach((change, position) => {
    const segmentId = change.segment.id;
    const existing = overrides.get(segmentId)?.state;
    let state: FeatureStateDoc;
    if (existing === undefined) {
      const rowId = lookups.newRowId();
      state = {
        django_id: rowId,
        enabled: change.enabled ?? environmentDefault.enabled,
        feature: { ...environmentDefault.feature },
        feature_segment: { priority: change.priority ?? freePriority(held, position) },
        feature_state_value: null,
        featurestate_uuid: placeholderUuid(rowId),
        multivariate_feature_state_values: [],
      };
      segmentFor(document, segmentId, lookups).feature_states.push(state);
      outcome.createdSegmentIds.push(segmentId);
    } else {
      state = existing;
      // An existing override moves only when the body gives it a priority.
      if (change.priority !== undefined) {
        state.feature_segment = { priority: change.priority };
      }
      state.enabled = change.enabled ?? environmentDefault.enabled;
      outcome.updatedSegmentIds.push(segmentId);
    }
    // What an override omits, it takes from the environment default written by the same body.
    state.feature_state_value =
      'value' in change
        ? typedValue(change.value ?? null, `segment_overrides[${position}].value`)
        : environmentDefault.feature_state_value;
    writeVariants(state, change.variants ?? variantWeights(environmentDefault), lookups);
    if (existing === undefined && splitsBetweenVariants(state)) {
      outcome.estimatedSplitSegmentIds.push(segmentId);
    }
  });

  // _check_priorities: precedence between two overrides with the same priority is undefined.
  const priorities = [...overridesBySegmentId(document, featureId).values()].flatMap(
    ({ state }) => {
      const priority = state.feature_segment?.priority;
      return priority === undefined || priority === null ? [] : [priority];
    },
  );
  const [duplicate] = priorities
    .filter((priority, index) => priorities.indexOf(priority) !== index)
    .sort(numerically);
  if (duplicate !== undefined) {
    reject(400, `Duplicate priority: ${duplicate}.`);
  }
}

/** check_segment_is_not_system, with the hint Flagsmith adds for a flag dependency. */
function rejectSystemSegment(document: EnvironmentDocument, segmentId: number): never {
  const segment = document.project.segments.find((candidate) => candidate.id === segmentId);
  const hint =
    segment !== undefined && isFlagDependency(segment.rules)
      ? ' Change this one through flag dependency instead.'
      : '';
  return reject(409, `System segments and their overrides can't be changed directly.${hint}`, {
    code: 'system_segment_modification',
  });
}

/** The segment Flagsmith writes for a dependency: `$.flags["<name>"].enabled NOT_EQUAL "true"`. */
function isFlagDependency(rules: readonly SegmentRuleDoc[]): boolean {
  const [rule, ...otherRules] = rules;
  if (rule === undefined || otherRules.length > 0 || rule.type !== 'ANY' || rule.rules.length > 0) {
    return false;
  }
  const [condition, ...otherConditions] = rule.conditions;
  return (
    condition !== undefined &&
    otherConditions.length === 0 &&
    condition.operator === 'NOT_EQUAL' &&
    condition.value === 'true' &&
    /^\$\.flags\[".+"\]\.enabled$/.test(condition.property_ ?? '')
  );
}

/** _write_variants: weights the given variants, creating the weights a state lacks. */
function writeVariants(
  state: FeatureStateDoc,
  variants: readonly VariantBody[],
  lookups: Lookups,
): void {
  for (const variant of variants) {
    const existing = state.multivariate_feature_state_values.find(
      (weight) => weight.multivariate_feature_option.id === variant.id,
    );
    if (existing !== undefined) {
      existing.percentage_allocation = variant.weight;
      continue;
    }
    const option = lookups.options.get(variant.id);
    if (option === undefined) {
      reject(400, `Variant not found: ${variant.id}.`);
    }
    const rowId = lookups.newRowId();
    state.multivariate_feature_state_values.push({
      id: rowId,
      multivariate_feature_option: { ...option },
      mv_fs_value_uuid: placeholderUuid(rowId),
      percentage_allocation: variant.weight,
    });
  }
}

/** map_variants: a state's weights by option, ordered by option ID. */
function variantWeights(state: FeatureStateDoc): VariantBody[] {
  return state.multivariate_feature_state_values
    .flatMap(({ multivariate_feature_option: option, percentage_allocation: weight }) =>
      option.id === null ? [] : [{ id: option.id, weight }],
    )
    .sort((a, b) => a.id - b.id);
}

/**
 * A flag dependency's override serves the environment default's value and variants
 * (`map_override_to_value_source`, features/dependencies/mappers.py), so the next document shows
 * the new default there too. The document marks such an override only by the default's bucketing
 * seed as its `django_id`, which no other override can carry: seeds are per segment lineage.
 */
function followEnvironmentDefault(
  document: EnvironmentDocument,
  environmentDefault: FeatureStateDoc,
): void {
  if (environmentDefault.django_id === null) {
    return;
  }
  for (const segment of document.project.segments) {
    for (const state of segment.feature_states) {
      if (
        state.feature.id === environmentDefault.feature.id &&
        state.django_id === environmentDefault.django_id
      ) {
        state.feature_state_value = environmentDefault.feature_state_value;
        state.multivariate_feature_state_values = structuredClone(
          environmentDefault.multivariate_feature_state_values,
        );
      }
    }
  }
}

/** Whether identities split between values, so their assignment depends on the unknown seed. */
function splitsBetweenVariants(state: FeatureStateDoc): boolean {
  return state.multivariate_feature_state_values.some(
    ({ percentage_allocation: weight }) => weight > 0 && weight < 100,
  );
}

/** The `position`-th priority, counting from 0, that no kept system override holds. */
function freePriority(held: ReadonlySet<number>, position: number): number {
  let free = -1;
  for (let priority = 0; ; priority++) {
    if (!held.has(priority)) {
      free++;
      if (free === position) {
        return priority;
      }
    }
  }
}

function overridesBySegmentId(
  document: EnvironmentDocument,
  featureId: number,
): Map<number, { segment: SegmentDoc; state: FeatureStateDoc }> {
  const overrides = new Map<number, { segment: SegmentDoc; state: FeatureStateDoc }>();
  for (const segment of document.project.segments) {
    const state = segment.feature_states.find((candidate) => candidate.feature.id === featureId);
    if (state !== undefined) {
      overrides.set(segment.id, { segment, state });
    }
  }
  return overrides;
}

/** The document's segment, or the listed one added, as the next document would include it. */
function segmentFor(
  document: EnvironmentDocument,
  segmentId: number,
  lookups: Lookups,
): SegmentDoc {
  const segment = document.project.segments.find((candidate) => candidate.id === segmentId);
  if (segment !== undefined) {
    return segment;
  }
  const listed = lookups.listed.get(segmentId);
  if (listed === undefined) {
    return reject(400, 'Segment not found.');
  }
  const added: SegmentDoc = {
    id: listed.id,
    name: listed.name,
    rules: structuredClone(listed.rules),
    feature_states: [],
  };
  document.project.segments.push(added);
  return added;
}

/** Every option the flag's states weight, by option ID. */
function variantOptions(
  document: EnvironmentDocument,
  featureId: number,
): Map<number, MultivariateOptionDoc> {
  const options = new Map<number, MultivariateOptionDoc>();
  for (const state of allStates(document).filter(
    (candidate) => candidate.feature.id === featureId,
  )) {
    for (const { multivariate_feature_option: option } of state.multivariate_feature_state_values) {
      if (option.id !== null) {
        options.set(option.id, option);
      }
    }
  }
  return options;
}

/**
 * IDs for the rows Flagsmith will create: above every ID in the document, as a new row's would
 * be, which keeps the variant order right. They are otherwise placeholders, and deterministic.
 */
function rowIdAllocator(document: EnvironmentDocument): () => number {
  let last = 0;
  for (const state of allStates(document)) {
    last = Math.max(
      last,
      state.django_id ?? 0,
      ...state.multivariate_feature_state_values.map((weight) => weight.id ?? 0),
    );
  }
  return () => ++last;
}

/** The environment defaults, segment overrides and identity overrides of the document. */
function allStates(document: EnvironmentDocument): FeatureStateDoc[] {
  return [
    ...document.feature_states,
    ...document.project.segments.flatMap((segment) => segment.feature_states),
    ...document.identity_overrides.flatMap((identity) => identity.identity_features),
  ];
}

/** A recognisable stand-in for the UUID of a row Flagsmith has not created. */
function placeholderUuid(rowId: number): string {
  return `00000000-0000-4000-8000-${rowId.toString(16).padStart(12, '0')}`;
}

function numerically(a: number, b: number): number {
  return a - b;
}

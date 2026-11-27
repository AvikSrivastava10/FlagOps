import type { FlagConfig, FlagState, FlagValue, SegmentOverride, Variant } from '@flagops/shared';
import type { DocumentFeatureState, EnvironmentDocument } from '../document.js';
import type { FlagApiConfig, FlagApiValue } from '../flag-api.js';
import { segmentKind, type ListedSegment } from './segment-kinds.js';

/**
 * The two ways FlagOps reads a flag's configuration, and the one shape both produce
 * (architecture.md 5.1). The sync reads environment documents; the flag API is read before and
 * after writes. A contract test keeps the two in agreement.
 */

function byOptionId(a: Variant, b: Variant): number {
  return a.optionId - b.optionId;
}

function bySegmentOrder(a: SegmentOverride, b: SegmentOverride): number {
  return a.priority - b.priority || a.segmentId - b.segmentId;
}

/** The flag API writes every value as a string, with its type beside it. */
export function fromFlagApiValue(value: FlagApiValue): FlagValue {
  if (value === null) {
    return null;
  }
  switch (value.type) {
    case 'integer':
      return Number(value.value);
    case 'boolean':
      return value.value === 'true';
    case 'string':
      return value.value;
  }
}

function documentState(state: DocumentFeatureState): FlagState {
  return {
    enabled: state.enabled,
    value: state.feature_state_value,
    variants: state.multivariate_feature_state_values
      .map((variant) => ({
        optionId: variant.multivariate_feature_option.id,
        weight: variant.percentage_allocation,
      }))
      .sort(byOptionId),
  };
}

function listedById(listed: readonly ListedSegment[]): Map<number, ListedSegment> {
  return new Map(listed.map((segment) => [segment.id, segment]));
}

/**
 * The flag's configuration in the document's environment, or null when the document has no
 * feature state for it (the flag is then `unknown` there, architecture.md 5.3).
 * `identityOverrideCount` is the feature list's `num_identity_overrides`, used when the
 * environment leaves identity overrides out of its document.
 */
export function fromEnvironmentDocument(
  document: EnvironmentDocument,
  featureId: number,
  listedSegments: readonly ListedSegment[],
  identityOverrideCount: number,
): FlagConfig | null {
  const environmentDefault = document.feature_states.find(
    (state) => state.feature.id === featureId,
  );
  if (environmentDefault === undefined) {
    return null;
  }
  const listed = listedById(listedSegments);
  const segmentOverrides = document.project.segments.flatMap((segment) =>
    segment.feature_states
      .filter((state) => state.feature.id === featureId && state.feature_segment !== null)
      .map((state): SegmentOverride => ({
        ...documentState(state),
        segmentId: segment.id,
        priority: state.feature_segment?.priority ?? 0,
        segment: segmentKind(segment.id, listed, segment.rules),
      })),
  );
  const identityOverrides = document.use_identity_overrides_in_local_eval
    ? document.identity_overrides
        .flatMap((identity) =>
          identity.identity_features
            .filter((state) => state.feature.id === featureId)
            .map((state) => ({
              identifier: identity.identifier,
              enabled: state.enabled,
              value: state.feature_state_value,
            })),
        )
        .sort((a, b) => (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0))
    : { count: identityOverrideCount };
  return {
    environmentDefault: documentState(environmentDefault),
    segmentOverrides: segmentOverrides.sort(bySegmentOrder),
    identityOverrides,
  };
}

function flagApiState(state: FlagApiConfig['environment_default']): FlagState {
  return {
    enabled: state.enabled,
    value: fromFlagApiValue(state.value),
    variants: state.variants
      .map((variant) => ({ optionId: variant.id, weight: variant.weight }))
      .sort(byOptionId),
  };
}

/**
 * The same configuration from the flag API. Segment kinds come from the segments list and the
 * rules in the environment's document; the identity overrides are the feature list's count.
 */
export function fromFlagApi(
  response: FlagApiConfig,
  listedSegments: readonly ListedSegment[],
  document: EnvironmentDocument,
  identityOverrideCount: number,
): FlagConfig {
  const listed = listedById(listedSegments);
  const rulesById = new Map(
    document.project.segments.map((segment) => [segment.id, segment.rules]),
  );
  return {
    environmentDefault: flagApiState(response.environment_default),
    segmentOverrides: response.segment_overrides
      .map((override): SegmentOverride => ({
        ...flagApiState(override),
        segmentId: override.segment.id,
        priority: override.priority,
        segment: segmentKind(override.segment.id, listed, rulesById.get(override.segment.id)),
      }))
      .sort(bySegmentOrder),
    identityOverrides: { count: identityOverrideCount },
  };
}

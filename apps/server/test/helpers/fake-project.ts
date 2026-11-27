import { featureContentTypeId, type FakeFlagsmith } from './fake-flagsmith.js';

/** IDs of the small project `addSmallProject` puts into a fake Flagsmith. */
export const small = {
  projectId: 1,
  environmentKey: 'key-development',
  userSegmentId: 10,
  /** A flag-dependency segment: a system segment, so the segments list leaves it out. */
  systemSegmentId: 11,
  standardFeatureId: 20,
  multivariateFeatureId: 21,
  optionId: 30,
  /** Binding IDs of two metadata fields. */
  typeBindingId: 40,
  stepsBindingId: 41,
} as const;

/**
 * One project with one environment, a user segment and a dependency segment, a standard flag and
 * a multivariate flag, and two metadata fields bound to features.
 */
export function addSmallProject(fake: FakeFlagsmith): void {
  const { state } = fake;
  state.projects.push({
    id: small.projectId,
    name: 'Shop',
    organisation: 1,
    hide_disabled_flags: false,
    stale_flags_limit_days: 30,
  });
  state.environments.push({
    id: 2,
    name: 'Development',
    api_key: small.environmentKey,
    project: small.projectId,
    minimum_change_request_approvals: null,
    hide_disabled_flags: null,
    use_v2_feature_versioning: true,
    use_identity_overrides_in_local_eval: true,
    use_identity_composite_key_for_hashing: true,
  });
  state.segments.push(
    {
      id: small.userSegmentId,
      project: small.projectId,
      name: 'beta_testers',
      description: '',
      feature: null,
      rules: [
        {
          type: 'ALL',
          rules: [
            {
              type: 'ANY',
              rules: [],
              conditions: [{ operator: 'EQUAL', property: 'beta', value: 'true' }],
            },
          ],
          conditions: [],
        },
      ],
      managed_by: '',
      is_system: false,
    },
    {
      id: small.systemSegmentId,
      project: small.projectId,
      name: 'gift_wrap-depends-on-new_checkout',
      description: '',
      feature: small.standardFeatureId,
      rules: [
        {
          type: 'ANY',
          rules: [],
          conditions: [
            { operator: 'NOT_EQUAL', property: '$.flags["new_checkout"].enabled', value: 'true' },
          ],
        },
      ],
      managed_by: 'dependency',
      is_system: true,
    },
  );
  const feature = {
    project: small.projectId,
    created_date: '2026-11-27T10:00:00.000000Z',
    tags: [],
    is_archived: false,
    is_server_key_only: false,
    metadata: [],
  };
  state.features.push(
    {
      ...feature,
      id: small.standardFeatureId,
      name: 'gift_wrap',
      type: 'STANDARD',
      description: 'Gift wrapping at checkout.',
      multivariate_options: [],
      initial_value: null,
    },
    {
      ...feature,
      id: small.multivariateFeatureId,
      name: 'recommendations_v2',
      type: 'MULTIVARIATE',
      description: null,
      multivariate_options: [
        { id: small.optionId, string_value: 'v2', default_percentage_allocation: 0 },
      ],
      initial_value: 'control',
    },
  );
  state.fields.push(
    { id: 50, name: 'flagops_type', type: 'str', organisation: 1, project: small.projectId },
    {
      id: 51,
      name: 'flagops_exit_plan',
      type: 'multiline_str',
      organisation: 1,
      project: small.projectId,
    },
  );
  state.bindings.push(
    { id: small.typeBindingId, field: 50, content_type: featureContentTypeId },
    { id: small.stepsBindingId, field: 51, content_type: featureContentTypeId },
  );
}

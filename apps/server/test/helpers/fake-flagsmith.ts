/**
 * An in-memory Flagsmith for offline tests. It answers the Admin API, flag API and sign-in
 * requests FlagOps sends, with the shapes, paging and quirks recorded from Flagsmith 2.295.2:
 * fixed pages of 10 where Flagsmith has them, `page_size` where it accepts one, metadata deleted
 * by an update that leaves it out, trimmed descriptions and values, no variant list on standard
 * flags, and dashboard HTML for unknown paths.
 */

type FakeUser = {
  id: number;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** The user's role per organisation ID. */
  roles: Record<number, 'ADMIN' | 'USER'>;
  /** With a code, the login asks for it (MFA). */
  mfaCode?: string;
};

type Value = string | number | boolean | null;
type ApiValue = { type: 'string' | 'integer' | 'boolean'; value: string } | null;
type ApiState = { enabled: boolean; value: ApiValue; variants: { id: number; weight: number }[] };
type ApiOverride = ApiState & { segment: { id: number }; priority: number };
type FlagState = { environment_default: ApiState; segment_overrides: ApiOverride[] };

type Rule = {
  type: string;
  rules: Rule[];
  conditions: { operator: string; property: string | null; value: string | null }[];
};

export type FakeState = {
  organisations: { id: number; name: string }[];
  projects: {
    id: number;
    name: string;
    organisation: number;
    hide_disabled_flags: boolean;
    stale_flags_limit_days: number;
  }[];
  environments: {
    id: number;
    name: string;
    api_key: string;
    project: number;
    minimum_change_request_approvals: number | null;
    hide_disabled_flags: boolean | null;
    use_v2_feature_versioning: boolean;
    use_identity_overrides_in_local_eval: boolean;
    use_identity_composite_key_for_hashing: boolean;
  }[];
  segments: {
    id: number;
    project: number;
    name: string;
    description: string;
    feature: number | null;
    rules: Rule[];
    managed_by: string;
    is_system: boolean;
  }[];
  tags: { id: number; project: number; label: string; color: string; is_permanent: boolean }[];
  fields: {
    id: number;
    name: string;
    type: string;
    organisation: number;
    project: number | null;
  }[];
  bindings: { id: number; field: number; content_type: number }[];
  features: {
    id: number;
    project: number;
    name: string;
    type: 'STANDARD' | 'MULTIVARIATE';
    created_date: string;
    description: string | null;
    tags: number[];
    is_archived: boolean;
    is_server_key_only: boolean;
    metadata: { model_field: number; field_value: string }[];
    multivariate_options: {
      id: number;
      string_value: string;
      default_percentage_allocation: number;
    }[];
    initial_value: string | null;
  }[];
  /** Keyed by `${environment api_key}:${feature id}`. */
  flags: Map<string, FlagState>;
  identities: {
    id: number;
    environment: string;
    identifier: string;
    traits: Map<string, Value>;
  }[];
  identityOverrides: {
    id: number;
    environment: string;
    identity: number;
    feature: number;
    enabled: boolean;
  }[];
  users: FakeUser[];
  /** Tokens Flagsmith issued, by value: the user they belong to. */
  tokens: Map<string, number>;
  ephemeralTokens: Map<string, number>;
  /** Permission groups, by organisation. */
  groups: { id: number; organisation: number; name: string }[];
  /** Feature owners: users and groups. */
  owners: { feature: number; kind: 'user' | 'group'; id: number }[];
  /** Every uploaded code references scan, oldest first. */
  codeReferenceScans: {
    project: number;
    repositoryUrl: string;
    revision: string;
    references: { feature_name: string; file_path: string; line_number: number }[];
  }[];
};

type RecordedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
};

export type FakeFlagsmith = {
  fetch: (request: Request) => Promise<Response>;
  state: FakeState;
  requests: RecordedRequest[];
  /** The writes received so far: every request other than GET. */
  writes(): RecordedRequest[];
  /** Makes the next request to a matching path fail with this status and body. */
  failNext(pathPattern: RegExp, status: number, body?: unknown): void;
  /** Answers sign-in with 204 and a `jwt` cookie, as an instance with COOKIE_AUTH_ENABLED does. */
  cookieMode: boolean;
};

export const fakeOrganisationKey = 'fake-organisation-key-000000';
export const featureContentTypeId = 56;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'flagsmith-version': '2.295.2', ...headers },
  });

function page<T>(items: readonly T[], query: URLSearchParams, acceptsPageSize: boolean) {
  const size = acceptsPageSize ? Math.min(Number(query.get('page_size') ?? 10), 999) : 10;
  const number = Number(query.get('page') ?? 1);
  const results = items.slice((number - 1) * size, number * size);
  const more = number * size < items.length;
  return {
    count: items.length,
    next: more ? `http://flagsmith.test/next?page=${number + 1}` : null,
    previous: number > 1 ? `http://flagsmith.test/previous?page=${number - 1}` : null,
    results,
  };
}

function toApiValue(value: Value): ApiValue {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return { type: 'integer', value: String(value) };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', value: String(value) };
  }
  return { type: 'string', value };
}

function fromApiValue(value: ApiValue): Value {
  if (value === null) {
    return null;
  }
  if (value.type === 'integer') {
    return Number(value.value);
  }
  return value.type === 'boolean' ? value.value === 'true' : value.value;
}

export function createFakeFlagsmith(): FakeFlagsmith {
  let nextId = 1000;
  const id = () => (nextId += 1);
  const state: FakeState = {
    organisations: [{ id: 1, name: 'FlagOps Demo' }],
    projects: [],
    environments: [],
    segments: [],
    tags: [],
    fields: [],
    bindings: [],
    features: [],
    flags: new Map(),
    identities: [],
    identityOverrides: [],
    users: [],
    tokens: new Map(),
    ephemeralTokens: new Map(),
    groups: [],
    owners: [],
    codeReferenceScans: [],
  };
  const requests: RecordedRequest[] = [];
  const failures: { pattern: RegExp; status: number; body: unknown }[] = [];

  function credentialUser(request: Request): number | 'organisation' | undefined {
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization === `Api-Key ${fakeOrganisationKey}`) {
      return 'organisation';
    }
    const token = authorization.startsWith('Token ')
      ? authorization.slice('Token '.length)
      : (request.headers.get('cookie') ?? '').replace(/^jwt=/, '');
    return state.tokens.get(token);
  }

  function flagOf(environment: string, featureId: number): FlagState {
    const key = `${environment}:${featureId}`;
    let flag = state.flags.get(key);
    if (flag === undefined) {
      const feature = state.features.find((item) => item.id === featureId);
      flag = {
        environment_default: {
          enabled: false,
          value:
            feature?.initial_value === null || feature === undefined
              ? null
              : toApiValue(feature.initial_value),
          variants: (feature?.multivariate_options ?? []).map((option) => ({
            id: option.id,
            weight: option.default_percentage_allocation,
          })),
        },
        segment_overrides: [],
      };
      state.flags.set(key, flag);
    }
    return flag;
  }

  function documentState(featureId: number, flag: ApiState, priority: number | null) {
    const feature = state.features.find((item) => item.id === featureId);
    return {
      feature: { id: featureId, name: feature?.name ?? '', type: feature?.type ?? 'STANDARD' },
      enabled: flag.enabled,
      django_id: featureId * 10 + (priority ?? 0),
      feature_segment: priority === null ? null : { priority },
      featurestate_uuid: `uuid-${featureId}`,
      feature_state_value: fromApiValue(flag.value),
      multivariate_feature_state_values: flag.variants.map((variant) => ({
        multivariate_feature_option: { id: variant.id, value: 'v', key: null },
        percentage_allocation: variant.weight,
        id: variant.id,
      })),
    };
  }

  function documentRules(rules: Rule[]): unknown[] {
    return rules.map((rule) => ({
      type: rule.type,
      rules: documentRules(rule.rules),
      conditions: rule.conditions.map((condition) => ({
        operator: condition.operator,
        value: condition.value,
        property_: condition.property,
      })),
    }));
  }

  function document(apiKey: string) {
    const environment = state.environments.find((item) => item.api_key === apiKey);
    const features = state.features.filter((item) => item.project === environment?.project);
    return {
      api_key: apiKey,
      feature_states: features.map((feature) =>
        documentState(feature.id, flagOf(apiKey, feature.id).environment_default, null),
      ),
      project: {
        segments: state.segments
          .filter((segment) => segment.project === environment?.project)
          .map((segment) => ({
            id: segment.id,
            name: segment.name,
            rules: documentRules(segment.rules),
            feature_states: features.flatMap((feature) =>
              flagOf(apiKey, feature.id)
                .segment_overrides.filter((override) => override.segment.id === segment.id)
                .map((override) => documentState(feature.id, override, override.priority)),
            ),
          })),
      },
      identity_overrides: state.identities
        .filter((identity) => identity.environment === apiKey)
        .map((identity) => ({
          identifier: identity.identifier,
          identity_features: state.identityOverrides
            .filter((override) => override.identity === identity.id)
            .map((override) =>
              documentState(
                override.feature,
                { enabled: override.enabled, value: null, variants: [] },
                null,
              ),
            ),
        }))
        .filter((identity) => identity.identity_features.length > 0),
      use_identity_overrides_in_local_eval:
        environment?.use_identity_overrides_in_local_eval ?? true,
    };
  }

  function featureBody(feature: FakeState['features'][number], environmentId?: number) {
    const environment = state.environments.find((item) => item.id === environmentId);
    const flag = environment === undefined ? undefined : flagOf(environment.api_key, feature.id);
    const identityOverrides =
      environment === undefined
        ? 0
        : state.identityOverrides.filter(
            (override) =>
              override.environment === environment.api_key && override.feature === feature.id,
          ).length;
    return {
      ...feature,
      multivariate_options: feature.multivariate_options.map((option) => ({
        ...option,
        type: 'unicode',
        integer_value: null,
        boolean_value: null,
      })),
      owners: state.owners
        .filter((owner) => owner.feature === feature.id && owner.kind === 'user')
        .map((owner) => ({
          id: owner.id,
          email: state.users.find((user) => user.id === owner.id)?.email ?? '',
        })),
      group_owners: state.owners
        .filter((owner) => owner.feature === feature.id && owner.kind === 'group')
        .map((owner) => ({
          id: owner.id,
          name: state.groups.find((group) => group.id === owner.id)?.name ?? '',
        })),
      num_segment_overrides: flag?.segment_overrides.length ?? 0,
      // Flagsmith gives null, not 0, for a feature without identity overrides.
      num_identity_overrides: identityOverrides === 0 ? null : identityOverrides,
      last_modified_in_any_environment: feature.created_date,
      lifecycle_stage: environment === undefined ? undefined : 'new',
      code_references_counts: codeReferenceCounts(feature),
    };
  }

  /**
   * As `annotate_feature_queryset_with_code_references_summary` computes them: one entry per
   * repository that ever listed the feature, counting its references in that repository's
   * latest scan, 0 when the latest scan has none.
   */
  function codeReferenceCounts(feature: FakeState['features'][number]) {
    const scans = state.codeReferenceScans.filter((scan) => scan.project === feature.project);
    const repositories = [...new Set(scans.map((scan) => scan.repositoryUrl))].sort();
    return repositories
      .filter((url) =>
        scans.some(
          (scan) =>
            scan.repositoryUrl === url &&
            scan.references.some((reference) => reference.feature_name === feature.name),
        ),
      )
      .map((url) => {
        const latest = scans.filter((scan) => scan.repositoryUrl === url).at(-1);
        const count =
          latest?.references.filter((reference) => reference.feature_name === feature.name)
            .length ?? 0;
        return { repository_url: url, count };
      });
  }

  /** An identity override as Flagsmith answers its writes, with `FeatureStateSerializerBasic`. */
  function overrideBody(override: FakeState['identityOverrides'][number]) {
    return {
      id: override.id,
      feature: override.feature,
      identity: override.identity,
      enabled: override.enabled,
      feature_state_value: null,
    };
  }

  type Handler = (
    match: RegExpMatchArray,
    request: Request,
    body: unknown,
    query: URLSearchParams,
  ) => Response;
  const routes: [string, RegExp, Handler][] = [
    [
      'GET',
      /^\/api\/v1\/organisations\/$/,
      (_m, request, _b, query) => {
        const user = credentialUser(request);
        const organisations =
          user === 'organisation'
            ? state.organisations.slice(0, 1)
            : state.organisations
                .filter((organisation) => {
                  const found = state.users.find((item) => item.id === user);
                  return found?.roles[organisation.id] !== undefined;
                })
                .map((organisation) => ({
                  ...organisation,
                  role: state.users.find((item) => item.id === user)?.roles[organisation.id],
                }));
        return json(200, page(organisations, query, false));
      },
    ],
    ['GET', /^\/api\/v1\/projects\/$/, () => json(200, state.projects)],
    [
      'POST',
      /^\/api\/v1\/projects\/$/,
      (_m, _r, body) => {
        const input = body as { name: string; organisation: number };
        const project = {
          id: id(),
          name: input.name,
          organisation: input.organisation,
          hide_disabled_flags: false,
          stale_flags_limit_days: 30,
        };
        state.projects.push(project);
        return json(201, project);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/$/,
      (m) => {
        const project = state.projects.find((item) => item.id === Number(m[1]));
        return project === undefined ? json(404, { detail: 'Not found.' }) : json(200, project);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/$/,
      (_m, _r, _b, query) => {
        if (!query.has('project')) {
          return json(400, { detail: 'project is required' });
        }
        return json(
          200,
          page(
            state.environments.filter((item) => item.project === Number(query.get('project'))),
            query,
            false,
          ),
        );
      },
    ],
    [
      'POST',
      /^\/api\/v1\/environments\/$/,
      (_m, _r, body) => {
        const input = body as { name: string; project: number };
        const environment = {
          id: id(),
          name: input.name,
          api_key: `key-${input.name.toLowerCase()}`,
          project: input.project,
          minimum_change_request_approvals: null,
          hide_disabled_flags: null,
          use_v2_feature_versioning: false,
          use_identity_overrides_in_local_eval: true,
          use_identity_composite_key_for_hashing: true,
        };
        state.environments.push(environment);
        return json(201, environment);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/([^/]+)\/$/,
      (m) => {
        const environment = state.environments.find((item) => item.api_key === m[1]);
        return environment === undefined
          ? json(404, { detail: 'Not found.' })
          : json(200, environment);
      },
    ],
    [
      'POST',
      /^\/api\/v1\/environments\/([^/]+)\/enable-v2-versioning\/$/,
      (m) => {
        const environment = state.environments.find((item) => item.api_key === m[1]);
        if (environment?.use_v2_feature_versioning === true) {
          return json(400, { detail: 'Environment is already using v2 versioning.' });
        }
        if (environment !== undefined) {
          environment.use_v2_feature_versioning = true;
        }
        return json(202, {});
      },
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/([^/]+)\/document\/$/,
      (m) => json(200, document(m[1] ?? '')),
    ],
    [
      'GET',
      /^\/api\/v1\/organisations\/(\d+)\/metadata-model-fields\/supported-content-types\/$/,
      () =>
        json(200, [
          { id: 28, app_label: 'organisations', model: 'organisation' },
          { id: featureContentTypeId, app_label: 'features', model: 'feature' },
        ]),
    ],
    [
      'GET',
      /^\/api\/v1\/organisations\/(\d+)\/metadata-model-fields\/$/,
      (_m, _r, _b, query) => json(200, page(state.bindings, query, false)),
    ],
    [
      'POST',
      /^\/api\/v1\/organisations\/(\d+)\/metadata-model-fields\/$/,
      (_m, _r, body) => {
        const input = body as { field: number; content_type: number };
        const binding = { id: id(), field: input.field, content_type: input.content_type };
        state.bindings.push(binding);
        return json(201, { ...binding, is_required_for: [] });
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/metadata\/fields\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.fields.filter((field) => field.project === Number(m[1])),
            query,
            true,
          ),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/metadata\/fields\/$/,
      (_m, _r, body) => {
        const input = body as { name: string; type: string; organisation: number; project: number };
        if (
          state.fields.some((field) => field.name === input.name && field.project === input.project)
        ) {
          return json(400, { name: ['A metadata field with this name already exists.'] });
        }
        const field = {
          id: id(),
          name: input.name,
          type: input.type,
          organisation: input.organisation,
          project: input.project,
        };
        state.fields.push(field);
        return json(201, field);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/tags\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.tags.filter((tag) => tag.project === Number(m[1])),
            query,
            false,
          ),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/projects\/(\d+)\/tags\/$/,
      (m, _r, body) => {
        const input = body as { label: string; color: string; is_permanent: boolean };
        const tag = {
          id: id(),
          project: Number(m[1]),
          label: input.label,
          color: input.color,
          is_permanent: input.is_permanent,
        };
        state.tags.push(tag);
        return json(201, tag);
      },
    ],
    [
      'PATCH',
      /^\/api\/v1\/projects\/(\d+)\/tags\/(\d+)\/$/,
      (m, _r, body) => {
        const tag = state.tags.find((item) => item.id === Number(m[2]));
        if (tag === undefined) {
          return json(404, { detail: 'Not found.' });
        }
        Object.assign(tag, body);
        return json(200, tag);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/segments\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.segments.filter(
              (segment) => segment.project === Number(m[1]) && !segment.is_system,
            ),
            query,
            true,
          ),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/projects\/(\d+)\/segments\/$/,
      (m, _r, body) => {
        const input = body as { name: string; description: string; rules: Rule[] };
        const segment = {
          id: id(),
          project: Number(m[1]),
          name: input.name,
          description: input.description,
          feature: null,
          rules: input.rules,
          managed_by: '',
          is_system: false,
        };
        state.segments.push(segment);
        return json(201, segment);
      },
    ],
    [
      'PUT',
      /^\/api\/v1\/projects\/(\d+)\/segments\/(\d+)\/$/,
      (m, _r, body) => {
        const segment = state.segments.find((item) => item.id === Number(m[2]));
        if (segment === undefined) {
          return json(404, { detail: 'Not found.' });
        }
        Object.assign(segment, body);
        return json(200, segment);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/features\/$/,
      (m, _r, _b, query) => {
        const environmentId = query.has('environment')
          ? Number(query.get('environment'))
          : undefined;
        const features = state.features.filter((feature) => feature.project === Number(m[1]));
        return json(
          200,
          page(
            features.map((feature) => featureBody(feature, environmentId)),
            query,
            true,
          ),
        );
      },
    ],
    [
      'GET',
      /^\/api\/v1\/organisations\/(\d+)\/users\/$/,
      (m) =>
        json(
          200,
          state.users
            .filter((user) => user.roles[Number(m[1])] !== undefined)
            .map((user) => ({
              id: user.id,
              email: user.email,
              first_name: user.firstName,
              last_name: user.lastName,
              role: user.roles[Number(m[1])],
            })),
        ),
    ],
    [
      'GET',
      /^\/api\/v1\/organisations\/(\d+)\/groups\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.groups
              .filter((group) => group.organisation === Number(m[1]))
              .map((group) => ({ id: group.id, name: group.name, users: [] })),
            query,
            false,
          ),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/projects\/(\d+)\/code-references\/$/,
      (m, _r, body) => {
        const input = body as {
          repository_url: string;
          revision: string;
          code_references: { feature_name: string; file_path: string; line_number: number }[];
        };
        const project = Number(m[1]);
        const names = new Set(
          state.features.filter((feature) => feature.project === project).map((item) => item.name),
        );
        // Flagsmith keeps only references to flags the project has, matched exactly.
        state.codeReferenceScans.push({
          project,
          repositoryUrl: input.repository_url,
          revision: input.revision,
          references: input.code_references.filter((reference) =>
            names.has(reference.feature_name),
          ),
        });
        return json(201, { ...input, project, vcs_provider: 'github' });
      },
    ],
    [
      'POST',
      /^\/api\/v1\/projects\/(\d+)\/features\/(\d+)\/(add|remove)-(group-)?owners\/$/,
      (m, _r, body) => {
        const feature = state.features.find((item) => item.id === Number(m[2]));
        if (feature === undefined) {
          return json(404, { detail: 'Not found.' });
        }
        const kind: 'user' | 'group' = m[4] === undefined ? 'user' : 'group';
        const ids =
          (body as { user_ids?: number[]; group_ids?: number[] })[
            kind === 'user' ? 'user_ids' : 'group_ids'
          ] ?? [];
        state.owners = state.owners.filter(
          (owner) =>
            !(owner.feature === feature.id && owner.kind === kind && ids.includes(owner.id)),
        );
        if (m[3] === 'add') {
          state.owners.push(...ids.map((ownerId) => ({ feature: feature.id, kind, id: ownerId })));
        }
        return json(200, featureBody(feature));
      },
    ],
    [
      'POST',
      /^\/api\/v1\/projects\/(\d+)\/features\/$/,
      (m, _r, body) => {
        const input = body as {
          name: string;
          description: string;
          type: 'STANDARD' | 'MULTIVARIATE';
          initial_value: string | null;
          multivariate_options: { string_value: string; default_percentage_allocation: number }[];
        };
        const feature = {
          id: id(),
          project: Number(m[1]),
          name: input.name,
          type: input.type,
          created_date: '2026-11-27T10:00:00.000000Z',
          description: input.description,
          tags: [],
          is_archived: false,
          is_server_key_only: false,
          metadata: [],
          multivariate_options: input.multivariate_options.map((option) => ({
            id: id(),
            ...option,
          })),
          initial_value: input.initial_value,
        };
        state.features.push(feature);
        return json(201, featureBody(feature));
      },
    ],
    [
      'GET',
      /^\/api\/v1\/projects\/(\d+)\/features\/(\d+)\/$/,
      (m) => {
        const feature = state.features.find((item) => item.id === Number(m[2]));
        return feature === undefined
          ? json(404, { detail: 'Not found.' })
          : json(200, featureBody(feature));
      },
    ],
    [
      'PATCH',
      /^\/api\/v1\/projects\/(\d+)\/features\/(\d+)\/$/,
      (m, _r, body) => {
        const feature = state.features.find((item) => item.id === Number(m[2]));
        if (feature === undefined) {
          return json(404, { detail: 'Not found.' });
        }
        const input = body as {
          metadata?: { model_field: number; field_value: string }[];
          tags?: number[];
          description?: string;
          is_archived?: boolean;
        };
        // The quirk: an update without `metadata` deletes every value (architecture.md 6.5).
        feature.metadata = (input.metadata ?? []).map((item) => ({
          ...item,
          field_value: item.field_value.trim(),
        }));
        if (input.tags !== undefined) {
          feature.tags = input.tags;
        }
        if (input.description !== undefined) {
          feature.description = input.description.trim();
        }
        if (input.is_archived !== undefined) {
          feature.is_archived = input.is_archived;
        }
        return json(200, featureBody(feature));
      },
    ],
    [
      'GET',
      /^\/api\/__future__\/environments\/([^/]+)\/features\/(\d+)\/$/,
      (m) => json(200, flagOf(m[1] ?? '', Number(m[2]))),
    ],
    [
      'PUT',
      /^\/api\/__future__\/environments\/([^/]+)\/features\/(\d+)\/$/,
      (m, _r, body) => {
        const environment = state.environments.find((item) => item.api_key === m[1]);
        if (environment !== undefined && environment.minimum_change_request_approvals !== null) {
          return json(409, {
            detail: 'Cannot make this change where change requests are enabled.',
            code: 'change_requests_enabled',
          });
        }
        const feature = state.features.find((item) => item.id === Number(m[2]));
        type BodyState = Omit<ApiState, 'variants'> & { variants?: ApiState['variants'] };
        const input = body as {
          environment_default: BodyState;
          segment_overrides: (BodyState & { segment: { id: number }; priority: number })[];
        };
        const states = [input.environment_default, ...input.segment_overrides];
        // Flagsmith refuses any variant list, even an empty one, on a standard flag.
        if (feature?.type === 'STANDARD' && states.some((item) => item.variants !== undefined)) {
          return json(400, { environment_default: { variants: ['Feature is not multivariate.'] } });
        }
        if (
          input.segment_overrides.some(
            (override) =>
              state.segments.find((segment) => segment.id === override.segment.id)?.is_system ===
              true,
          )
        ) {
          return json(409, {
            code: 'system_segment_modification',
            message: "System segments and their overrides can't be changed directly.",
          });
        }
        const withVariants = (item: BodyState): ApiState => ({
          ...item,
          variants: item.variants ?? [],
        });
        state.flags.set(`${m[1]}:${m[2]}`, {
          environment_default: withVariants(input.environment_default),
          segment_overrides: input.segment_overrides.map((override) => ({
            ...withVariants(override),
            segment: override.segment,
            priority: override.priority,
          })),
        });
        return json(200, flagOf(m[1] ?? '', Number(m[2])));
      },
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/([^/]+)\/identities\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.identities
              .filter((identity) => identity.environment === m[1])
              .map((identity) => ({
                id: identity.id,
                identifier: identity.identifier,
                environment: 1,
              })),
            query,
            true,
          ),
        ),
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/([^/]+)\/identities\/(\d+)\/traits\/$/,
      (m, _r, _b, query) => {
        const identity = state.identities.find((item) => item.id === Number(m[2]));
        const traits = [...(identity?.traits ?? new Map<string, Value>())].map(([key, value]) => ({
          trait_key: key,
          value_type:
            typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'unicode',
          integer_value: typeof value === 'number' ? value : null,
          string_value: typeof value === 'string' ? value : null,
          boolean_value: typeof value === 'boolean' ? value : null,
          float_value: null,
        }));
        return json(200, page(traits, query, false));
      },
    ],
    [
      'PUT',
      /^\/api\/v1\/traits\/bulk\/$/,
      (_m, request, body) => {
        const environment = request.headers.get('x-environment-key') ?? '';
        for (const item of body as {
          identity: { identifier: string };
          trait_key: string;
          trait_value: Value;
        }[]) {
          let identity = state.identities.find(
            (entry) =>
              entry.environment === environment && entry.identifier === item.identity.identifier,
          );
          if (identity === undefined) {
            identity = {
              id: id(),
              environment,
              identifier: item.identity.identifier,
              traits: new Map(),
            };
            state.identities.push(identity);
          }
          if (item.trait_value === null) {
            identity.traits.delete(item.trait_key);
          } else {
            identity.traits.set(item.trait_key, item.trait_value);
          }
        }
        return json(200, []);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/environments\/([^/]+)\/featurestates\/$/,
      (m, _r, _b, query) =>
        json(
          200,
          page(
            state.identityOverrides
              .filter(
                (override) =>
                  override.environment === m[1] &&
                  override.feature === Number(query.get('feature')),
              )
              .map((override) => ({
                id: override.id,
                identity: {
                  id: override.identity,
                  identifier: state.identities.find((identity) => identity.id === override.identity)
                    ?.identifier,
                },
                enabled: override.enabled,
                feature_state_value: null,
              })),
            query,
            false,
          ),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/environments\/([^/]+)\/identities\/(\d+)\/featurestates\/$/,
      (m, _r, body) => {
        const input = body as { feature: number; enabled: boolean };
        const override = {
          id: id(),
          environment: m[1] ?? '',
          identity: Number(m[2]),
          feature: input.feature,
          enabled: input.enabled,
        };
        state.identityOverrides.push(override);
        return json(201, overrideBody(override));
      },
    ],
    [
      'PATCH',
      /^\/api\/v1\/environments\/([^/]+)\/identities\/(\d+)\/featurestates\/(\d+)\/$/,
      (m, _r, body) => {
        const override = state.identityOverrides.find((item) => item.id === Number(m[3]));
        if (override === undefined) {
          return json(404, { detail: 'Not found.' });
        }
        override.enabled = (body as { enabled: boolean }).enabled;
        return json(200, overrideBody(override));
      },
    ],
    [
      'POST',
      /^\/api\/v1\/auth\/login\/$/,
      (_m, _r, body) => {
        const input = body as { email: string; password: string };
        const user = state.users.find(
          (item) => item.email === input.email && item.password === input.password,
        );
        if (user === undefined) {
          return json(400, { non_field_errors: ['Unable to log in with provided credentials.'] });
        }
        if (user.mfaCode !== undefined) {
          const ephemeral = `ephemeral-${user.id}-${id()}`;
          state.ephemeralTokens.set(ephemeral, user.id);
          return json(200, { ephemeral_token: ephemeral, method: 'app' });
        }
        return issue(user.id);
      },
    ],
    [
      'POST',
      /^\/api\/v1\/auth\/login\/code\/$/,
      (_m, _r, body) => {
        const input = body as { code: string; ephemeral_token: string };
        const userId = state.ephemeralTokens.get(input.ephemeral_token);
        const user = state.users.find((item) => item.id === userId);
        if (user === undefined || user.mfaCode !== input.code) {
          return json(401, { error: 'Invalid or expired code.' });
        }
        return issue(user.id);
      },
    ],
    [
      'GET',
      /^\/api\/v1\/auth\/users\/me\/$/,
      (_m, request) => {
        const user = state.users.find((item) => item.id === credentialUser(request));
        if (user === undefined) {
          return json(401, { detail: 'Authentication credentials were not provided.' });
        }
        return json(200, {
          id: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
        });
      },
    ],
  ];

  const fake: FakeFlagsmith = {
    state,
    requests,
    cookieMode: false,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    failNext(pattern, status, body) {
      failures.push({ pattern, status, body });
    },
    async fetch(request) {
      const url = new URL(request.url);
      const text = await request.text();
      const body: unknown = text === '' ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
      const failure = failures.findIndex((item) => item.pattern.test(url.pathname));
      if (failure !== -1) {
        const [{ status, body: failureBody }] = failures.splice(failure, 1) as [
          (typeof failures)[number],
        ];
        return json(status, failureBody ?? { detail: 'Injected failure.' });
      }
      const isAuth = url.pathname.startsWith('/api/v1/auth/login');
      if (
        !isAuth &&
        credentialUser(request) === undefined &&
        request.headers.get('x-environment-key') === null
      ) {
        return json(401, { detail: 'Authentication credentials were not provided.' });
      }
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(url.pathname);
        if (method === request.method && match !== null) {
          return handler(match, request, body, url.searchParams);
        }
      }
      // Flagsmith answers unknown paths with its dashboard (architecture.md 6.5).
      return new Response('<!doctype html><title>Flagsmith</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  };

  function issue(userId: number): Response {
    const token = `token-${userId}-${id()}`;
    state.tokens.set(token, userId);
    return fake.cookieMode
      ? new Response(null, {
          status: 204,
          headers: {
            'set-cookie': `jwt=${token}; HttpOnly; Path=/`,
            'flagsmith-version': '2.295.2',
          },
        })
      : json(200, { key: token });
  }

  return fake;
}

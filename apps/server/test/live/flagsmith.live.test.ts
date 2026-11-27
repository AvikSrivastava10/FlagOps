import { beforeAll, describe, expect, it } from 'vitest';
import { getEnvironmentDocument, type EnvironmentDocument } from '../../src/flagsmith/document.js';
import {
  getEnvironment,
  listEnvironments,
  type Environment,
} from '../../src/flagsmith/environments.js';
import { listFeatures, type ListedFeature } from '../../src/flagsmith/features.js';
import { getFlag, putFlag, type FlagApiBody } from '../../src/flagsmith/flag-api.js';
import { listIdentities, listTraits } from '../../src/flagsmith/identities-api.js';
import { fromEnvironmentDocument, fromFlagApi } from '../../src/flagsmith/mappers/flag-config.js';
import {
  featureContentTypeId,
  flagopsFieldNames,
  listMetadataBindings,
  listProjectMetadataFields,
} from '../../src/flagsmith/metadata.js';
import {
  keyOrganisationResolver,
  listProjects,
  organisationOfKey,
  type Project,
} from '../../src/flagsmith/projects.js';
import { listSegments, type Segment } from '../../src/flagsmith/segments.js';
import { listTags } from '../../src/flagsmith/tags.js';
import { createInventoryStore } from '../../src/inventory/store.js';
import { createInventorySync } from '../../src/inventory/sync.js';
import { createLogger } from '../../src/logger.js';
import { captureLogs } from '../helpers/log-capture.js';
import { liveClient, liveOrganisationKey, skipReason } from '../helpers/live.js';

/**
 * The live read suite of plan S3.1, the mapper contract (S3.5) and the declarative PUT round trip
 * (S3.4), against the seeded demo organisation. It confirms the `[unverified live]` reads of
 * architecture.md 6.3 that Stage 3 owns.
 */
const skip = skipReason('FLAGSMITH_URL', 'FLAGSMITH_ORG_API_KEY');

describe.skipIf(skip !== undefined)(
  `Flagsmith adapter, live${skip === undefined ? '' : ` (${skip})`}`,
  () => {
    const client = liveClient();
    const credential = liveOrganisationKey();
    let project: Project;
    let environments: Environment[];
    let segments: Segment[];
    const documents = new Map<string, EnvironmentDocument>();
    const features = new Map<string, ListedFeature[]>();

    beforeAll(async () => {
      const [first] = await listProjects(client, credential);
      if (first === undefined) {
        throw new Error('The demo organisation has no project: run pnpm seed first');
      }
      project = first;
      environments = await listEnvironments(client, credential, project.id);
      segments = await listSegments(client, credential, project.id);
      for (const environment of environments) {
        documents.set(
          environment.name,
          await getEnvironmentDocument(client, credential, environment.api_key),
        );
        features.set(
          environment.name,
          await listFeatures(client, credential, project.id, environment.id),
        );
      }
    });

    function environmentNamed(name: string): Environment {
      const found = environments.find((item) => item.name === name);
      if (found === undefined) {
        throw new Error(`no environment ${name}`);
      }
      return found;
    }

    function featureNamed(environment: string, name: string): ListedFeature {
      const found = features.get(environment)?.find((item) => item.name === name);
      if (found === undefined) {
        throw new Error(`no feature ${name} in ${environment}`);
      }
      return found;
    }

    it('resolves the organisation of the key and its one project, with the project settings', async () => {
      expect((await organisationOfKey(client, credential)).name).toBe('FlagOps Demo');
      expect(await listProjects(client, credential)).toEqual([
        {
          id: project.id,
          name: 'FlagOps Demo Shop',
          organisation: project.organisation,
          hide_disabled_flags: false,
          stale_flags_limit_days: 30,
        },
      ]);
      expect(client.observedVersion()).toBe('2.295.2');
    });

    it('reads the environment settings, hide_disabled_flags included', async () => {
      expect(environments.map((item) => item.name)).toEqual([
        'Development',
        'Staging',
        'Production',
      ]);
      for (const environment of environments) {
        expect(await getEnvironment(client, credential, environment.api_key)).toMatchObject({
          hide_disabled_flags: null,
          minimum_change_request_approvals: null,
          use_v2_feature_versioning: true,
          use_identity_overrides_in_local_eval: true,
          use_identity_composite_key_for_hashing: true,
        });
      }
    });

    it('reads environment documents, with django_id on multivariate states', () => {
      const production = documents.get('Production');
      const recommendations = production?.feature_states.find(
        (state) => state.feature.name === 'recommendations_v2',
      );
      expect(recommendations?.multivariate_feature_state_values).toHaveLength(1);
      expect(typeof recommendations?.django_id).toBe('number');
      expect(production?.identity_overrides.map((identity) => identity.identifier)).toEqual([
        'user-0010',
        'user-0020',
        'user-0030',
      ]);
    });

    it('reads the feature list fields FlagOps relies on, num_identity_overrides included', () => {
      expect(features.get('Production')).toHaveLength(10);
      expect(featureNamed('Production', 'dark_mode')).toMatchObject({
        num_segment_overrides: 1,
        num_identity_overrides: 3,
        is_server_key_only: false,
        is_archived: false,
      });
      // Flagsmith gives null, not 0, for a feature without identity overrides.
      expect(featureNamed('Production', 'new_checkout').num_identity_overrides).toBeNull();
      for (const feature of features.get('Production') ?? []) {
        expect(feature.last_modified_in_any_environment).not.toBeNull();
        expect(feature.lifecycle_stage).not.toBeNull();
      }
    });

    it('lists the segments, with managed_by, feature-specific ones included, and no system segments', () => {
      expect(
        segments.map((segment) => [segment.name, segment.managed_by, segment.feature]),
      ).toEqual([
        ['beta_testers', '', null],
        ['staff', '', null],
      ]);
    });

    it('lists the type tags; ops and permission are permanent', async () => {
      const tags = await listTags(client, credential, project.id);
      expect(tags.map((tag) => [tag.label, tag.is_permanent])).toEqual([
        ['type:release', false],
        ['type:experiment', false],
        ['type:ops', true],
        ['type:permission', true],
      ]);
    });

    it('discovers the metadata fields and their bindings with the API key', async () => {
      const fields = await listProjectMetadataFields(client, credential, project.id);
      const contentType = await featureContentTypeId(client, credential, project.organisation);
      const bindings = await listMetadataBindings(
        client,
        credential,
        project.organisation,
        contentType,
      );

      expect(fields.map((field) => field.name).sort()).toEqual([...flagopsFieldNames].sort());
      expect(bindings.map((binding) => binding.field).sort()).toEqual(
        fields.map((field) => field.id).sort(),
      );
    });

    it('reads identities and typed traits, which the bulk upload wrote', async () => {
      const production = environmentNamed('Production');
      const identities = await listIdentities(client, credential, production.api_key);
      const user7 = identities.find((identity) => identity.identifier === 'user-0007');

      expect(identities).toHaveLength(1000);
      expect(
        user7 === undefined
          ? undefined
          : await listTraits(client, credential, production.api_key, user7.id),
      ).toEqual(
        new Map<string, unknown>([
          ['beta', true],
          ['role', 'customer'],
          ['plan', 'free'],
        ]),
      );
    });

    it('gives the same configuration from the document and from the flag API, for every flag and environment', async () => {
      let compared = 0;
      for (const environment of environments) {
        const document = documents.get(environment.name);
        if (document === undefined) {
          throw new Error(`no document for ${environment.name}`);
        }
        for (const feature of features.get(environment.name) ?? []) {
          const count = feature.num_identity_overrides ?? 0;
          const flag = await getFlag(client, credential, {
            environmentKey: environment.api_key,
            featureId: feature.id,
          });
          const fromDocument = fromEnvironmentDocument(document, feature.id, segments, count);
          const fromApi = fromFlagApi(flag, segments, document, count);

          expect(fromApi.environmentDefault, `${environment.name} ${feature.name}`).toEqual(
            fromDocument?.environmentDefault,
          );
          expect(fromApi.segmentOverrides, `${environment.name} ${feature.name}`).toEqual(
            fromDocument?.segmentOverrides,
          );
          expect(fromDocument?.identityOverrides).toHaveLength(count);
          compared += 1;
        }
      }
      expect(compared).toBe(30);
    });

    it('syncs the inventory: every flag, in every environment, in the normalised shape', async () => {
      const store = createInventoryStore();
      const sync = createInventorySync({
        client,
        credential,
        keyOrganisation: keyOrganisationResolver(client, credential),
        projectId: undefined,
        store,
        logger: createLogger('error', captureLogs().destination),
      });

      const inventory = await sync.run();

      expect(inventory.flags).toHaveLength(10);
      expect(inventory.environments.map((item) => item.name)).toEqual([
        'Development',
        'Staging',
        'Production',
      ]);
      const production = inventory.environments[2]?.id ?? -1;
      const darkMode = inventory.flags.find((flag) => flag.name === 'dark_mode');
      expect(darkMode?.environments[production]).toMatchObject({
        segmentOverrideCount: 1,
        identityOverrideCount: 3,
        config: {
          environmentDefault: { enabled: false },
          segmentOverrides: [{ segment: { kind: 'user' } }],
        },
      });
      expect(darkMode?.metadata.flagops_type).toBe('release');
      expect(inventory.flags.every((flag) => Object.keys(flag.environments).length === 3)).toBe(
        true,
      );
      expect(inventory.flagsmithVersion).toBe('2.295.2');
    });

    it('round-trips a declarative PUT: a change, then the previous configuration, reads back as the original', async () => {
      const development = environmentNamed('Development');
      const target = {
        environmentKey: development.api_key,
        featureId: featureNamed('Development', 'dark_mode').id,
      };
      const listed = new Set(segments.map((segment) => segment.id));
      const beta = segments.find((segment) => segment.name === 'beta_testers');
      const original = await getFlag(client, credential, target);
      const changed: FlagApiBody = {
        environment_default: { enabled: false, value: null },
        segment_overrides: [
          { segment: { id: beta?.id ?? 0 }, priority: 0, enabled: true, value: null },
        ],
      };
      const previous: FlagApiBody = {
        environment_default: {
          enabled: original.environment_default.enabled,
          value: original.environment_default.value,
        },
        segment_overrides: original.segment_overrides.map((override) => ({
          segment: override.segment,
          priority: override.priority,
          enabled: override.enabled,
          value: override.value,
        })),
      };

      try {
        const afterChange = await putFlag(client, credential, target, changed, listed);
        expect(afterChange.environment_default.enabled).toBe(false);
        expect(afterChange.segment_overrides).toHaveLength(1);
      } finally {
        await putFlag(client, credential, target, previous, listed);
      }

      expect(await getFlag(client, credential, target)).toEqual(original);
    });
  },
);

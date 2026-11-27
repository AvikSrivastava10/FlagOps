import { FlagOpsError } from '@flagops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { addSmallProject, manageSmallProject, small } from '../../test/helpers/fake-project.js';
import type { FlagsmithClient } from './client.js';
import { uploadCodeReferences } from './code-references.js';
import { createEnvironment, enableV2Versioning } from './environments.js';
import { createFeature, updateFeature } from './features.js';
import { putFlag } from './flag-api.js';
import { createIdentityOverride, updateIdentityOverride, upsertTraits } from './identities-api.js';
import { setupMetadataFields } from './metadata.js';
import { changeOwners } from './owners.js';
import { createProject } from './projects.js';
import { createSegment, updateSegment } from './segments.js';
import { setupTypeTags } from './tags.js';
import { createWriteGuard } from './write-guard.js';

const demo = { id: 1, name: 'FlagOps Demo' };
const shop = { id: 1, name: 'Shop', organisation: 1 };
const development = { name: 'Development', api_key: 'key-development', project: 1 };

/** The message of the refusal a guard call throws, or undefined when the guard admits it. */
function refusal(call: () => void): string | undefined {
  try {
    call();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(FlagOpsError);
    expect((error as FlagOpsError).code).toBe('flagsmith_project_not_managed');
    return (error as FlagOpsError).message;
  }
}

describe('createWriteGuard', () => {
  it('refuses every write until a project is managed', () => {
    const guard = createWriteGuard();

    expect(
      refusal(() => {
        guard.checkProject(1);
      }),
    ).toContain('it has not selected the Flagsmith project it manages yet');
  });

  it('refuses to manage a project of another organisation, or environments of another project', () => {
    const guard = createWriteGuard();

    expect(
      refusal(() => {
        guard.manage(demo, { ...shop, organisation: 2 }, []);
      }),
    ).toContain('belongs to organisation 2, not to FlagOps Demo (ID 1)');
    expect(
      refusal(() => {
        guard.manage(demo, shop, [{ ...development, project: 7 }]);
      }),
    ).toContain('Development belongs to project 7');
    expect(
      refusal(() => {
        guard.checkProject(1);
      }),
    ).toBeDefined();
  });

  it('admits the managed project, its organisation and its environments, and nothing else', () => {
    const guard = createWriteGuard();
    guard.manage(demo, shop, [development]);

    guard.checkOrganisation(1);
    guard.checkProject(1);
    guard.checkEnvironment('key-development');
    expect(
      refusal(() => {
        guard.checkProject(5);
      }),
    ).toBe(
      'FlagOps writes only to the Flagsmith project it manages, Shop (ID 1), and refused a write to project 5.',
    );
    expect(
      refusal(() => {
        guard.checkOrganisation(2);
      }),
    ).toBeDefined();
    expect(
      refusal(() => {
        guard.checkEnvironment('key-production');
      }),
    ).toBeDefined();
  });
});

describe('the write functions of the adapter', () => {
  let fake: FakeFlagsmith;
  let client: FlagsmithClient;

  beforeEach(() => {
    ({ fake, client } = fakeClient());
    addSmallProject(fake);
    manageSmallProject(fake, client);
  });

  const segment = { name: 'staff', description: '', rules: [] };
  const writes: [string, (client: FlagsmithClient) => Promise<unknown>][] = [
    ['createEnvironment', (c) => createEnvironment(c, organisationKey, { name: 'QA', project: 9 })],
    ['enableV2Versioning', (c) => enableV2Versioning(c, organisationKey, 'key-other')],
    [
      'createFeature',
      (c) =>
        createFeature(c, organisationKey, 9, {
          name: 'x',
          description: '',
          initialValue: null,
          multivariateOptions: [],
        }),
    ],
    [
      'updateFeature',
      (c) =>
        updateFeature(c, organisationKey, { projectId: 9, featureId: 20 }, { isArchived: true }),
    ],
    [
      'putFlag',
      (c) =>
        putFlag(
          c,
          organisationKey,
          { environmentKey: 'key-other', featureId: small.standardFeatureId },
          { environment_default: { enabled: true, value: null }, segment_overrides: [] },
          new Set(),
        ),
    ],
    ['upsertTraits', (c) => upsertTraits(c, 'key-other', [])],
    [
      'createIdentityOverride',
      (c) =>
        createIdentityOverride(c, organisationKey, 'key-other', 1, { feature: 20, enabled: true }),
    ],
    [
      'updateIdentityOverride',
      (c) =>
        updateIdentityOverride(c, organisationKey, 'key-other', {
          identityId: 1,
          featureStateId: 2,
          enabled: true,
        }),
    ],
    [
      'setupMetadataFields, another organisation',
      (c) => setupMetadataFields(c, organisationKey, { organisationId: 2, projectId: 1 }),
    ],
    [
      'setupMetadataFields, another project',
      (c) => setupMetadataFields(c, organisationKey, { organisationId: 1, projectId: 9 }),
    ],
    ['setupTypeTags', (c) => setupTypeTags(c, organisationKey, 9, {})],
    [
      'changeOwners',
      (c) =>
        changeOwners(
          c,
          organisationKey,
          { projectId: 9, featureId: 20 },
          { kind: 'user', action: 'add', ids: [7] },
        ),
    ],
    [
      'uploadCodeReferences',
      (c) =>
        uploadCodeReferences(c, organisationKey, 9, {
          repositoryUrl: 'https://github.com/acme/shop',
          revision: 'abc',
          references: [],
        }),
    ],
    ['createSegment', (c) => createSegment(c, organisationKey, 9, segment)],
    ['updateSegment', (c) => updateSegment(c, organisationKey, 9, small.userSegmentId, segment)],
  ];

  it.each(writes)(
    '%s refuses a target outside the managed project before any request',
    async (_, write) => {
      const error: unknown = await write(client).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(FlagOpsError);
      expect((error as FlagOpsError).code).toBe('flagsmith_project_not_managed');
      expect(fake.requests).toEqual([]);
    },
  );

  it('lets createProject, the one write before a managed project, use only the organisation of the key', async () => {
    const { fake: empty, client: fresh } = fakeClient();

    const project = await createProject(fresh, organisationKey, 'FlagOps Demo Shop');

    expect(project.organisation).toBe(1);
    expect(empty.writes().map((request) => request.body)).toEqual([
      { name: 'FlagOps Demo Shop', organisation: 1 },
    ]);
  });
});

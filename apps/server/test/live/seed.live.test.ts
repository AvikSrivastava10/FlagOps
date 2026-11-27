import { describe, expect, it } from 'vitest';
import { offsetDate, runSeed } from '../../src/cli/seed-runner.js';
import { seedFlags } from '../../src/cli/seed-data.js';
import { findDescriptionLine, withDescriptionLine } from '../../src/exitplan/description-line.js';
import { listEnvironments } from '../../src/flagsmith/environments.js';
import {
  getFeature,
  listFeatures,
  updateFeature,
  type Feature,
} from '../../src/flagsmith/features.js';
import { getFlag } from '../../src/flagsmith/flag-api.js';
import { listIdentities, listIdentityOverrides } from '../../src/flagsmith/identities-api.js';
import { setupMetadataFields, type FlagopsFields } from '../../src/flagsmith/metadata.js';
import { listProjects } from '../../src/flagsmith/projects.js';
import { listTags, type TypeTagIds } from '../../src/flagsmith/tags.js';
import { createLogger } from '../../src/logger.js';
import { captureLogs } from '../helpers/log-capture.js';
import { liveClient, liveFlagsmithUrl, liveOrganisationKey, skipReason } from '../helpers/live.js';

/**
 * The seed against the demo organisation (plan S3.2, S3.3 and DR-7). It expects the demo data in
 * place, as `pnpm seed` leaves it, and leaves it in place: the harness's changes are repaired by
 * the seed itself.
 */
const skip = skipReason('FLAGSMITH_URL', 'FLAGSMITH_ORG_API_KEY');
const seedTimeout = 6 * 60_000;

describe.skipIf(skip !== undefined)(`seed, live${skip === undefined ? '' : ` (${skip})`}`, () => {
  const client = liveClient();
  const credential = liveOrganisationKey();
  let typeTagIds: TypeTagIds = {};

  const seed = () =>
    runSeed({
      client,
      credential,
      typeTagIds: {
        load: () => typeTagIds,
        save: (ids) => {
          typeTagIds = ids;
        },
      },
      logger: createLogger('error', captureLogs().destination),
    });

  async function seededProject() {
    const [project] = await listProjects(client, credential);
    if (project === undefined) {
      throw new Error('The demo organisation has no project: run pnpm seed first');
    }
    const environments = await listEnvironments(client, credential, project.id);
    return { project, environments };
  }

  async function giftWrap(projectId: number): Promise<Feature> {
    const listed = (await listFeatures(client, credential, projectId, undefined)).find(
      (feature) => feature.name === 'gift_wrap',
    );
    if (listed === undefined) {
      throw new Error('the demo project has no gift_wrap');
    }
    return getFeature(client, credential, { projectId, featureId: listed.id });
  }

  async function fieldsOf(project: { id: number; organisation: number }): Promise<FlagopsFields> {
    return (
      await setupMetadataFields(client, credential, {
        organisationId: project.organisation,
        projectId: project.id,
      })
    ).fields;
  }

  it(
    'finds the data of architecture.md 13.1 in place, so a run reports no changes',
    async () => {
      expect(await seed()).toEqual({ changes: [], warnings: [] });
    },
    seedTimeout,
  );

  it('holds the identities, overrides, states and exit plans of the demo data', async () => {
    const { project, environments } = await seededProject();
    const counts = await Promise.all(
      environments.map(async (environment) => [
        environment.name,
        (await listIdentities(client, credential, environment.api_key)).length,
      ]),
    );
    expect(counts).toEqual([
      ['Development', 50],
      ['Staging', 200],
      ['Production', 1000],
    ]);

    const production = environments.find((environment) => environment.name === 'Production');
    const features = await listFeatures(client, credential, project.id, production?.id);
    const darkMode = features.find((feature) => feature.name === 'dark_mode');
    const overrides = await listIdentityOverrides(
      client,
      credential,
      production?.api_key ?? '',
      darkMode?.id ?? 0,
    );
    expect(overrides.map((override) => [override.identity.identifier, override.enabled])).toEqual([
      ['user-0010', true],
      ['user-0020', true],
      ['user-0030', true],
    ]);

    const recommendations = features.find((feature) => feature.name === 'recommendations_v2');
    const weights = await Promise.all(
      environments.map(async (environment) => {
        const flag = await getFlag(client, credential, {
          environmentKey: environment.api_key,
          featureId: recommendations?.id ?? 0,
        });
        return [flag.environment_default.enabled, flag.environment_default.variants[0]?.weight];
      }),
    );
    expect(weights).toEqual([
      [true, 100],
      [true, 50],
      [false, 0],
    ]);

    const tags = await listTags(client, credential, project.id);
    for (const seedFlag of seedFlags) {
      const feature = features.find((item) => item.name === seedFlag.name);
      const plan = seedFlag.exitPlan;
      const line = findDescriptionLine(feature?.description ?? '');
      const labels = (feature?.tags ?? []).map((id) => tags.find((tag) => tag.id === id)?.label);
      if (plan === null) {
        expect(line, seedFlag.name).toBeNull();
        expect(labels, seedFlag.name).toEqual([]);
      } else {
        const expiresAt =
          plan.deadlineOffsetDays === null
            ? null
            : offsetDate(feature?.created_date ?? '', plan.deadlineOffsetDays);
        expect(line, seedFlag.name).toBe(
          `FlagOps: ${plan.type} · ${expiresAt === null ? 'permanent' : `remove by ${expiresAt}`}`,
        );
        expect(labels, seedFlag.name).toEqual([`type:${plan.type}`]);
      }
    }
  });

  it(
    "keeps metadata through updateFeature(), confirms Flagsmith's metadata quirk, and has the seed repair a demo take (DR-7)",
    async () => {
      const { project } = await seededProject();
      const fields = await fieldsOf(project);
      const ref = { projectId: project.id, featureId: (await giftWrap(project.id)).id };
      const seeded = await giftWrap(project.id);
      expect(seeded.metadata).toHaveLength(3);

      // updateFeature() changes the description and keeps every metadata value.
      const changed = await updateFeature(client, credential, ref, {
        description: (current) => `${current}\nA note from the live suite.`,
      });
      expect(changed.description).toBe(`${seeded.description ?? ''}\nA note from the live suite.`);
      expect(changed.metadata).toEqual(seeded.metadata);

      // A raw PATCH without `metadata` deletes all of it (architecture.md 6.5). This is why
      // updateFeature() is the only code that writes a feature.
      const raw = await fetch(
        `${liveFlagsmithUrl()}/api/v1/projects/${project.id}/features/${ref.featureId}/`,
        {
          method: 'PATCH',
          headers: {
            authorization: `Api-Key ${process.env.FLAGSMITH_ORG_API_KEY ?? ''}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ description: changed.description }),
        },
      );
      expect(raw.status).toBe(200);
      expect((await giftWrap(project.id)).metadata).toEqual([]);

      // A demo take: archived, a cleanup PR recorded, the FlagOps line rewritten.
      const pr = 'https://github.com/AvikSrivastava10/flagops-demo-shop/pull/999';
      await updateFeature(client, credential, ref, {
        metadata: new Map([[fields.flagops_cleanup_prs.bindingId, pr]]),
        description: (current) =>
          withDescriptionLine(current, `FlagOps: release · remove by 2026-01-01 · ${pr}`),
        isArchived: true,
      });
      const take = await giftWrap(project.id);
      expect(take).toMatchObject({ is_archived: true });
      expect(take.metadata).toEqual([expect.objectContaining({ field_value: pr })]);

      const report = await seed();

      expect(report.changes).toEqual(['Wrote the exit plan of gift_wrap']);
      const repaired = await giftWrap(project.id);
      expect(repaired.is_archived).toBe(false);
      expect(repaired.description).toBe(seeded.description);
      expect(repaired.metadata.map((item) => [item.model_field, item.field_value]).sort()).toEqual(
        seeded.metadata.map((item) => [item.model_field, item.field_value]).sort(),
      );
      expect(
        repaired.metadata.some((item) => item.model_field === fields.flagops_cleanup_prs.bindingId),
      ).toBe(false);
    },
    seedTimeout,
  );

  it(
    'reports no changes on the run after the repair',
    async () => {
      expect(await seed()).toEqual({ changes: [], warnings: [] });
    },
    seedTimeout,
  );
});

import { setTimeout as sleep } from 'node:timers/promises';
import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import { mapConcurrently } from '../concurrency.js';
import { formatDescriptionLine, withDescriptionLine } from '../exitplan/description-line.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import {
  createEnvironment,
  enableV2Versioning,
  getEnvironment,
  listEnvironments,
  type Environment,
} from '../flagsmith/environments.js';
import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  type Feature,
} from '../flagsmith/features.js';
import { flagMatches, getFlag, putFlag, type FlagApiBody } from '../flagsmith/flag-api.js';
import {
  createIdentityOverride,
  listIdentities,
  listIdentityOverrides,
  listTraits,
  updateIdentityOverride,
  upsertTraits,
  type TraitUpsert,
} from '../flagsmith/identities-api.js';
import { setupMetadataFields, type FlagopsFields } from '../flagsmith/metadata.js';
import {
  createProject,
  listProjects,
  organisationOfKey,
  type Project,
} from '../flagsmith/projects.js';
import { createSegment, listSegments, updateSegment, type Segment } from '../flagsmith/segments.js';
import { setupTypeTags, type TypeTagIds } from '../flagsmith/tags.js';
import {
  seedEnvironmentNames,
  seedFlags,
  seedIdentifier,
  seedIdentityCounts,
  seedProjectName,
  seedSegments,
  seedTraits,
  type SeedEnvironmentName,
  type SeedFlag,
} from './seed-data.js';

export type SeedContext = {
  client: FlagsmithClient;
  /** The organisation API key: the seed writes nothing as a user. */
  credential: FlagsmithCredential;
  /** Where FlagOps records the IDs of its own type tags (architecture.md 5.7). */
  typeTagIds: { load(): TypeTagIds; save(ids: TypeTagIds): void };
  logger: Logger;
  /** Pause between checks while Flagsmith switches an environment to v2 versioning. */
  pollIntervalMs?: number;
};

export type SeedReport = { changes: string[]; warnings: string[] };

/** Requests in flight at once while the seed reads identities' traits (architecture.md 6.4). */
const concurrentReads = 6;

/** Identities per bulk trait upload. */
const identitiesPerUpload = 250;

const v2PollTimeoutMs = 120_000;

type Run = SeedContext & { report: SeedReport };

function changed(run: Run, change: string): void {
  run.report.changes.push(change);
  run.logger.info({ change }, change);
}

function warn(run: Run, warning: string): void {
  run.report.warnings.push(warning);
  run.logger.warn({ warning }, warning);
}

/**
 * Seeds the demo project of architecture.md 13.1 in the organisation of the API key, in the order
 * that section gives, so every write sees v2 versioning. Each step reads first and writes only
 * what differs from the demo data, so a second run reports no changes, and a run after a demo
 * repairs every seeded object (DR-7). Objects the seed did not create are never changed or
 * deleted; the few that would change the demo's numbers are reported as warnings.
 */
export async function runSeed(
  context: SeedContext,
  report: SeedReport = { changes: [], warnings: [] },
): Promise<SeedReport> {
  // The caller may pass the report in, so it keeps the changes made before a failure.
  const run: Run = { ...context, report };
  const organisation = await organisationOfKey(run.client, run.credential);
  const project = await ensureProject(run, organisation);
  const environments = await ensureEnvironments(run, project);
  await ensureV2Versioning(run, environments);
  const fields = await ensureMetadataFields(run, organisation.id, project.id);
  const tagIds = await ensureTypeTags(run, project.id);
  const segments = await ensureSegments(run, project.id);
  const features = await ensureFeatures(run, project.id, environments);
  await ensureFlagStates(run, environments, features, segments);
  await ensureIdentities(run, environments);
  await ensureIdentityOverrides(run, project.id, environments, features);
  await ensureExitPlans(run, project.id, features, fields, tagIds);
  run.logger.info(
    { changes: run.report.changes.length, warnings: run.report.warnings.length },
    run.report.changes.length === 0
      ? 'Seed finished: the demo data was already in place'
      : `Seed finished with ${run.report.changes.length} changes`,
  );
  return run.report;
}

async function ensureProject(
  run: Run,
  organisation: { id: number; name: string },
): Promise<Project> {
  const projects = (await listProjects(run.client, run.credential)).filter(
    (project) => project.organisation === organisation.id,
  );
  const others = projects.filter((project) => project.name !== seedProjectName);
  if (others.length > 0) {
    throw new FlagOpsError(
      'validation_failed',
      `The seed refuses to run: the organisation ${organisation.name} already holds ${others.map((project) => `"${project.name}"`).join(', ')}. Open-source Flagsmith allows one project per organisation, so the seed needs an organisation of its own. Create one for the demo, and use its API key.`,
    );
  }
  const existing = projects[0];
  if (existing !== undefined) {
    return existing;
  }
  const project = await createProject(run.client, run.credential, {
    name: seedProjectName,
    organisation: organisation.id,
  });
  changed(run, `Created the project ${seedProjectName}`);
  return project;
}

type SeedEnvironments = Record<SeedEnvironmentName, Environment>;

async function ensureEnvironments(run: Run, project: Project): Promise<SeedEnvironments> {
  const existing = await listEnvironments(run.client, run.credential, project.id);
  const environments: Partial<SeedEnvironments> = {};
  for (const name of seedEnvironmentNames) {
    let environment = existing.find((item) => item.name === name);
    if (environment === undefined) {
      environment = await createEnvironment(run.client, run.credential, {
        name,
        project: project.id,
      });
      changed(run, `Created the environment ${name}`);
    }
    environments[name] = environment;
  }
  const extra = existing.filter(
    (item) => !(seedEnvironmentNames as readonly string[]).includes(item.name),
  );
  if (extra.length > 0) {
    warn(
      run,
      `The project also has ${extra.map((item) => item.name).join(', ')}. The demo's expected stages assume Development, Staging and Production only.`,
    );
  }
  return environments as SeedEnvironments;
}

/**
 * Flagsmith switches an environment to v2 versioning in a background task, so the seed waits
 * until every environment reports it (architecture.md 6.5).
 */
async function ensureV2Versioning(run: Run, environments: SeedEnvironments): Promise<void> {
  for (const environment of Object.values(environments)) {
    if (!environment.use_v2_feature_versioning) {
      await enableV2Versioning(run.client, run.credential, environment.api_key);
      changed(run, `Enabled feature versioning v2 in ${environment.name}`);
    }
  }
  const deadline = Date.now() + v2PollTimeoutMs;
  for (const name of seedEnvironmentNames) {
    let environment = environments[name];
    while (!environment.use_v2_feature_versioning) {
      if (Date.now() > deadline) {
        throw new FlagOpsError(
          'flagsmith_unexpected_response',
          `${name} has not switched to feature versioning v2 after ${v2PollTimeoutMs / 1000} seconds. Check that Flagsmith's task processor is running, then run the seed again.`,
        );
      }
      await sleep(run.pollIntervalMs ?? 1000);
      environment = await getEnvironment(run.client, run.credential, environment.api_key);
    }
    environments[name] = environment;
  }
}

async function ensureMetadataFields(
  run: Run,
  organisationId: number,
  projectId: number,
): Promise<FlagopsFields> {
  const setup = await setupMetadataFields(run.client, run.credential, {
    organisationId,
    projectId,
  });
  for (const name of setup.created) {
    changed(run, `Created the metadata field ${name}`);
  }
  for (const name of setup.bound) {
    changed(run, `Bound the metadata field ${name} to features`);
  }
  return setup.fields;
}

async function ensureTypeTags(run: Run, projectId: number): Promise<Required<TypeTagIds>> {
  const setup = await setupTypeTags(run.client, run.credential, projectId, run.typeTagIds.load());
  run.typeTagIds.save(setup.tagIds);
  for (const type of setup.created) {
    changed(run, `Created the tag type:${type}`);
  }
  for (const type of setup.corrected) {
    changed(run, `Corrected "permanent" on the tag type:${type}`);
  }
  if (setup.problems.length > 0) {
    throw new FlagOpsError('validation_failed', setup.problems.join(' '));
  }
  // Without problems, setupTypeTags settled a tag for every type.
  return setup.tagIds as Required<TypeTagIds>;
}

function sameRules(a: Segment['rules'], b: Segment['rules']): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function ensureSegments(run: Run, projectId: number): Promise<Segment[]> {
  const segments = await listSegments(run.client, run.credential, projectId);
  for (const seed of seedSegments) {
    const segment = segments.find((item) => item.name === seed.name && item.feature === null);
    if (segment === undefined) {
      segments.push(await createSegment(run.client, run.credential, projectId, seed));
      changed(run, `Created the segment ${seed.name}`);
    } else if (!sameRules(segment.rules, seed.rules)) {
      const updated = await updateSegment(run.client, run.credential, projectId, segment.id, seed);
      segments.splice(segments.indexOf(segment), 1, updated);
      changed(run, `Restored the rules of the segment ${seed.name}`);
    }
  }
  return segments;
}

type SeedFeatures = Map<string, Feature>;

async function ensureFeatures(
  run: Run,
  projectId: number,
  environments: SeedEnvironments,
): Promise<SeedFeatures> {
  const listed = await listFeatures(
    run.client,
    run.credential,
    projectId,
    environments.Development.id,
  );
  const features: SeedFeatures = new Map();
  for (const seed of seedFlags) {
    let feature: Feature | undefined = listed.find((item) => item.name === seed.name);
    if (feature === undefined) {
      feature = await createFeature(run.client, run.credential, projectId, {
        name: seed.name,
        description: seed.description,
        initialValue: seed.value?.value ?? null,
        multivariateOptions:
          seed.variantOption === undefined
            ? []
            : [{ stringValue: seed.variantOption, defaultPercentageAllocation: 0 }],
      });
      changed(run, `Created the flag ${seed.name}`);
    }
    checkFeatureShape(seed, feature);
    features.set(seed.name, feature);
  }
  return features;
}

/** A flag's type and options cannot be changed after creation, so a mismatch stops the seed. */
function checkFeatureShape(seed: SeedFlag, feature: Feature): void {
  const wantsOption = seed.variantOption !== undefined;
  const hasOption = feature.multivariate_options.some(
    (option) => option.string_value === seed.variantOption,
  );
  if (wantsOption !== (feature.type === 'MULTIVARIATE') || (wantsOption && !hasOption)) {
    throw new FlagOpsError(
      'validation_failed',
      `The flag ${seed.name} exists with a shape the seed cannot repair (${feature.type}, ${feature.multivariate_options.length} options). Delete it in Flagsmith, then run the seed again.`,
    );
  }
}

/** The flag API configuration the demo data asks for in one environment. */
function desiredFlag(
  seed: SeedFlag,
  feature: Feature,
  environment: SeedEnvironmentName,
  segments: readonly Segment[],
): FlagApiBody {
  const state = seed.environments[environment];
  const option = feature.multivariate_options.find(
    (item) => item.string_value === seed.variantOption,
  );
  return {
    environment_default: {
      enabled: state.enabled,
      value: seed.value,
      // A replace-PUT on a multivariate flag must weight every variant (architecture.md 13.1);
      // a standard flag takes no variant list at all.
      ...(option === undefined
        ? {}
        : { variants: [{ id: option.id, weight: state.variantWeight ?? 0 }] }),
    },
    segment_overrides: (state.segmentOverrides ?? []).map((override, priority) => {
      const segment = segments.find(
        (item) => item.name === override.segment && item.feature === null,
      );
      if (segment === undefined) {
        throw new Error(`The seed has no segment ${override.segment}`);
      }
      return {
        segment: { id: segment.id },
        priority,
        enabled: override.enabled,
        value: seed.value,
      };
    }),
  };
}

async function ensureFlagStates(
  run: Run,
  environments: SeedEnvironments,
  features: SeedFeatures,
  segments: readonly Segment[],
): Promise<void> {
  const listedSegmentIds = new Set(segments.map((segment) => segment.id));
  for (const name of seedEnvironmentNames) {
    const environment = environments[name];
    for (const seed of seedFlags) {
      const feature = features.get(seed.name);
      if (feature === undefined) {
        throw new Error(`The seed has no feature ${seed.name}`);
      }
      const target = { environmentKey: environment.api_key, featureId: feature.id };
      const desired = desiredFlag(seed, feature, name, segments);
      const current = await getFlag(run.client, run.credential, target);
      if (!flagMatches(desired, current, listedSegmentIds)) {
        await putFlag(run.client, run.credential, target, desired, listedSegmentIds);
        changed(run, `Set ${seed.name} in ${name}`);
      }
    }
  }
}

function sameTraits(
  stored: ReadonlyMap<string, unknown>,
  wanted: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(wanted);
  return stored.size === keys.length && keys.every((key) => stored.get(key) === wanted[key]);
}

/**
 * Creates the demo identities and restores their traits. Reading the traits costs one request per
 * identity (they page at a fixed 10), so the reads run 6 at a time; the uploads go through the
 * bulk endpoint, which creates missing identities itself.
 */
async function ensureIdentities(run: Run, environments: SeedEnvironments): Promise<void> {
  for (const name of seedEnvironmentNames) {
    const environment = environments[name];
    const existing = new Map(
      (await listIdentities(run.client, run.credential, environment.api_key)).map((identity) => [
        identity.identifier,
        identity.id,
      ]),
    );
    const numbers = Array.from({ length: seedIdentityCounts[name] }, (_, index) => index + 1);
    const stale = await mapConcurrently(numbers, concurrentReads, async (number) => {
      const identityId = existing.get(seedIdentifier(number));
      if (identityId === undefined) {
        return { number, stored: new Map<string, unknown>() };
      }
      const stored = await listTraits(run.client, run.credential, environment.api_key, identityId);
      return sameTraits(stored, seedTraits(number)) ? undefined : { number, stored };
    });
    const upserts: TraitUpsert[][] = [];
    for (const identity of stale) {
      if (identity === undefined) {
        continue;
      }
      const identifier = seedIdentifier(identity.number);
      const wanted = seedTraits(identity.number);
      upserts.push([
        ...Object.entries(wanted).map(([key, value]) => ({ identifier, key, value })),
        ...[...identity.stored.keys()]
          .filter((key) => !(key in wanted))
          .map((key) => ({ identifier, key, value: null })),
      ]);
    }
    for (let start = 0; start < upserts.length; start += identitiesPerUpload) {
      await upsertTraits(
        run.client,
        environment.api_key,
        upserts.slice(start, start + identitiesPerUpload).flat(),
      );
    }
    if (upserts.length > 0) {
      const created = stale.filter(
        (identity) => identity !== undefined && !existing.has(seedIdentifier(identity.number)),
      ).length;
      changed(
        run,
        `Wrote the traits of ${upserts.length} identities in ${name}, ${created} of them new`,
      );
    }
  }
}

async function ensureIdentityOverrides(
  run: Run,
  projectId: number,
  environments: SeedEnvironments,
  features: SeedFeatures,
): Promise<void> {
  for (const name of seedEnvironmentNames) {
    const environment = environments[name];
    const counts = new Map(
      (await listFeatures(run.client, run.credential, projectId, environment.id)).map((feature) => [
        feature.id,
        feature.num_identity_overrides ?? 0,
      ]),
    );
    const identities = new Map(
      (await listIdentities(run.client, run.credential, environment.api_key)).map((identity) => [
        identity.identifier,
        identity.id,
      ]),
    );
    for (const seed of seedFlags) {
      const feature = features.get(seed.name);
      const wanted = seed.environments[name].identityOverrides ?? [];
      if (feature === undefined || (wanted.length === 0 && (counts.get(feature.id) ?? 0) === 0)) {
        continue;
      }
      const current = await listIdentityOverrides(
        run.client,
        run.credential,
        environment.api_key,
        feature.id,
      );
      for (const identifier of wanted) {
        const identityId = identities.get(identifier);
        if (identityId === undefined) {
          throw new Error(
            `The identity ${identifier} is missing in ${name} after the trait upload`,
          );
        }
        const override = current.find((item) => item.identity.identifier === identifier);
        if (override === undefined) {
          await createIdentityOverride(
            run.client,
            run.credential,
            environment.api_key,
            identityId,
            {
              feature: feature.id,
              enabled: true,
            },
          );
          changed(run, `Turned ${seed.name} on for ${identifier} in ${name}`);
        } else if (!override.enabled) {
          await updateIdentityOverride(run.client, run.credential, environment.api_key, {
            identityId,
            featureStateId: override.id,
            enabled: true,
          });
          changed(run, `Turned ${seed.name} back on for ${identifier} in ${name}`);
        }
      }
      for (const override of current) {
        if (!wanted.includes(override.identity.identifier)) {
          warn(
            run,
            `${seed.name} has an identity override for ${override.identity.identifier} in ${name}, which is not part of the demo data and changes its impact preview. Remove it in Flagsmith.`,
          );
        }
      }
    }
  }
}

/** The calendar day `days` after the UTC date of `isoTimestamp`, as `YYYY-MM-DD`. */
export function offsetDate(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type ExitPlanFields = {
  metadata: Map<number, string | null>;
  tagId: number | undefined;
  description: string;
};

function seededExitPlan(
  seed: SeedFlag,
  feature: Feature,
  fields: FlagopsFields,
  tagIds: Required<TypeTagIds>,
): ExitPlanFields {
  const plan = seed.exitPlan;
  const expiresAt =
    plan?.deadlineOffsetDays === null || plan === null
      ? null
      : offsetDate(feature.created_date, plan.deadlineOffsetDays);
  return {
    metadata: new Map([
      [fields.flagops_type.bindingId, plan?.type ?? null],
      [fields.flagops_expires_at.bindingId, expiresAt],
      [fields.flagops_exit_plan.bindingId, plan?.steps ?? null],
      // DR-7: a cleanup the demo opened leaves PR links; the seed clears them.
      [fields.flagops_cleanup_prs.bindingId, null],
    ]),
    tagId: plan === null ? undefined : tagIds[plan.type],
    description:
      plan === null
        ? seed.description
        : withDescriptionLine(
            seed.description,
            formatDescriptionLine({ type: plan.type, expiresAt, cleanupPrs: [] }),
          ),
  };
}

function exitPlanInPlace(
  feature: Feature,
  wanted: ExitPlanFields,
  ownTags: readonly number[],
): boolean {
  const stored = new Map(feature.metadata.map((item) => [item.model_field, item.field_value]));
  const metadataInPlace = [...wanted.metadata].every(
    ([bindingId, value]) => (stored.get(bindingId) ?? null) === value,
  );
  const tags = feature.tags.filter((tagId) => ownTags.includes(tagId));
  const tagsInPlace =
    wanted.tagId === undefined ? tags.length === 0 : tags.length === 1 && tags[0] === wanted.tagId;
  return (
    metadataInPlace &&
    tagsInPlace &&
    (feature.description ?? '') === wanted.description &&
    !feature.is_archived
  );
}

/**
 * Writes each flag's exit plan through `updateFeature()`: the metadata, the one `type:` tag and
 * the description with its FlagOps line. It also un-archives the flag and clears its cleanup PR
 * links, so the demo can be recorded again after a cleanup (DR-7).
 */
async function ensureExitPlans(
  run: Run,
  projectId: number,
  features: SeedFeatures,
  fields: FlagopsFields,
  tagIds: Required<TypeTagIds>,
): Promise<void> {
  const ownTags = Object.values(tagIds);
  for (const seed of seedFlags) {
    const listed = features.get(seed.name);
    if (listed === undefined) {
      continue;
    }
    const ref = { projectId, featureId: listed.id };
    const feature = await getFeature(run.client, run.credential, ref);
    const wanted = seededExitPlan(seed, feature, fields, tagIds);
    if (exitPlanInPlace(feature, wanted, ownTags)) {
      continue;
    }
    await updateFeature(run.client, run.credential, ref, {
      metadata: wanted.metadata,
      tags: { remove: ownTags, add: wanted.tagId === undefined ? [] : [wanted.tagId] },
      description: () => wanted.description,
      isArchived: false,
    });
    changed(
      run,
      seed.exitPlan === null
        ? `Restored ${seed.name}, which has no exit plan`
        : `Wrote the exit plan of ${seed.name}`,
    );
  }
}

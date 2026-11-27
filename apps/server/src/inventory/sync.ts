import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import { mapConcurrently } from '../concurrency.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import { getEnvironmentDocument, type EnvironmentDocument } from '../flagsmith/document.js';
import { listEnvironments, type Environment } from '../flagsmith/environments.js';
import { changeRequestsBlockWrites } from '../flagsmith/change-requests.js';
import { listFeatures, type ListedFeature } from '../flagsmith/features.js';
import { fromEnvironmentDocument } from '../flagsmith/mappers/flag-config.js';
import {
  featureContentTypeId,
  flagopsFieldNames,
  listMetadataBindings,
  listProjectMetadataFields,
  type FlagopsFieldName,
} from '../flagsmith/metadata.js';
import { listProjects, type Organisation, type Project } from '../flagsmith/projects.js';
import { listSegments, type Segment } from '../flagsmith/segments.js';
import { listTags } from '../flagsmith/tags.js';
import type { InventoryStore } from './store.js';
import type { Inventory, InventoryFlag } from './types.js';

export type InventorySyncOptions = {
  client: FlagsmithClient;
  /** The organisation key: syncing is background work (D-008). */
  credential: FlagsmithCredential;
  keyOrganisation: () => Promise<Organisation>;
  /** `FLAGSMITH_PROJECT_ID`, when set. */
  projectId: number | undefined;
  store: InventoryStore;
  logger: Logger;
  now?: () => Date;
};

export type InventorySync = { run(): Promise<Inventory> };

/** Flagsmith requests in flight at once during a sync (architecture.md 6.4). */
const concurrentRequests = 6;

/**
 * The project FlagOps manages: `FLAGSMITH_PROJECT_ID` when set, else the organisation's only
 * project (features.md S1.3). The sync hands it to the adapter's write guard, so writes go only
 * to this project (architecture.md 6.6).
 */
function selectProject(
  projects: readonly Project[],
  organisation: Organisation,
  projectId: number | undefined,
): Project {
  const own = projects.filter((project) => project.organisation === organisation.id);
  if (projectId !== undefined) {
    const selected = own.find((project) => project.id === projectId);
    if (selected === undefined) {
      throw new FlagOpsError(
        'flagsmith_not_found',
        `FLAGSMITH_PROJECT_ID is ${projectId}, but the organisation ${organisation.name} has no project with that ID.`,
      );
    }
    return selected;
  }
  const [only] = own;
  if (only === undefined) {
    throw new FlagOpsError(
      'flagsmith_not_found',
      `No project in organisation ${organisation.name}. Run the seed or create a project in Flagsmith.`,
    );
  }
  if (own.length > 1) {
    throw new FlagOpsError(
      'flagsmith_not_found',
      `The organisation ${organisation.name} has ${own.length} projects. Set FLAGSMITH_PROJECT_ID to the one FlagOps manages.`,
    );
  }
  return only;
}

/** Which FlagOps field each feature binding holds, so feature metadata can be read by name. */
async function fieldNamesByBinding(
  options: InventorySyncOptions,
  organisationId: number,
  projectId: number,
  contentTypeId: number,
): Promise<Map<number, FlagopsFieldName>> {
  const [fields, bindings] = await Promise.all([
    listProjectMetadataFields(options.client, options.credential, projectId),
    listMetadataBindings(options.client, options.credential, organisationId, contentTypeId),
  ]);
  const names = new Map<number, FlagopsFieldName>();
  for (const name of flagopsFieldNames) {
    const field = fields.find((item) => item.name === name && item.project === projectId);
    const binding = bindings.find((item) => item.field === field?.id);
    if (binding !== undefined) {
      names.set(binding.id, name);
    }
  }
  return names;
}

type EnvironmentReads = {
  environment: Environment;
  document: EnvironmentDocument;
  features: ListedFeature[];
};

function inventoryFlag(
  feature: ListedFeature,
  reads: readonly EnvironmentReads[],
  segments: readonly Segment[],
  fieldNames: ReadonlyMap<number, FlagopsFieldName>,
): InventoryFlag {
  const metadata = Object.fromEntries(flagopsFieldNames.map((name) => [name, null])) as Record<
    FlagopsFieldName,
    string | null
  >;
  for (const item of feature.metadata) {
    const name = fieldNames.get(item.model_field);
    if (name !== undefined) {
      metadata[name] = item.field_value;
    }
  }
  const environments: InventoryFlag['environments'] = {};
  for (const { environment, document, features } of reads) {
    const listed = features.find((item) => item.id === feature.id);
    // Flagsmith gives no count, rather than 0, for a feature without identity overrides.
    const identityOverrideCount = listed?.num_identity_overrides ?? 0;
    environments[environment.id] = {
      config: fromEnvironmentDocument(document, feature.id, segments, identityOverrideCount),
      segmentOverrideCount: listed?.num_segment_overrides ?? 0,
      identityOverrideCount,
      flagsmithLifecycleStage: listed?.lifecycle_stage ?? null,
    };
  }
  return {
    id: feature.id,
    name: feature.name,
    description: feature.description ?? '',
    createdDate: feature.created_date,
    isArchived: feature.is_archived,
    isServerKeyOnly: feature.is_server_key_only,
    tagIds: feature.tags,
    owners: feature.owners,
    groupOwners: feature.group_owners,
    metadata,
    lastModifiedInAnyEnvironment: feature.last_modified_in_any_environment,
    codeReferenceCounts: feature.code_references_counts.map((count) => ({
      repositoryUrl: count.repository_url,
      count: count.count,
    })),
    environments,
  };
}

/**
 * Builds the inventory from Flagsmith (architecture.md 6.4, steps 1-4 and 6), with the
 * organisation key. Configurations come from the environment documents, one request per
 * environment; the feature lists add metadata, owners, tags, counts and timestamps. Any failed
 * request fails the whole sync, and the previous inventory stays in place.
 */
export function createInventorySync(options: InventorySyncOptions): InventorySync {
  const now = options.now ?? (() => new Date());
  let contentTypeId: number | undefined;

  async function read(): Promise<Inventory> {
    const { client, credential } = options;
    const organisation = await options.keyOrganisation();
    contentTypeId ??= await featureContentTypeId(client, credential, organisation.id);
    const projects = await listProjects(client, credential);
    const project = selectProject(projects, organisation, options.projectId);
    const environments = (await listEnvironments(client, credential, project.id)).sort(
      (a, b) => a.id - b.id,
    );
    client.writeGuard.manage(organisation, project, environments);
    const [segments, tags, fieldNames] = await Promise.all([
      listSegments(client, credential, project.id),
      listTags(client, credential, project.id),
      fieldNamesByBinding(options, organisation.id, project.id, contentTypeId),
    ]);
    const reads = await mapConcurrently(
      environments,
      concurrentRequests / 2,
      async (environment): Promise<EnvironmentReads> => {
        const [document, features] = await Promise.all([
          getEnvironmentDocument(client, credential, environment.api_key),
          listFeatures(client, credential, project.id, environment.id),
        ]);
        return { environment, document, features };
      },
    );
    const features =
      reads[0]?.features ?? (await listFeatures(client, credential, project.id, undefined));
    return {
      syncedAt: now().toISOString(),
      flagsmithVersion: client.observedVersion(),
      organisation: { id: organisation.id, name: organisation.name },
      project: {
        id: project.id,
        name: project.name,
        hideDisabledFlags: project.hide_disabled_flags,
        staleFlagsLimitDays: project.stale_flags_limit_days,
      },
      environments: environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        apiKey: environment.api_key,
        v2Versioning: environment.use_v2_feature_versioning,
        changeRequestsBlockWrites: changeRequestsBlockWrites(environment),
        hideDisabledFlags: environment.hide_disabled_flags ?? project.hide_disabled_flags,
      })),
      segments: segments.map((segment) => ({
        id: segment.id,
        name: segment.name,
        managedBy: segment.managed_by ?? '',
      })),
      tags: tags.map((tag) => ({ id: tag.id, label: tag.label, isPermanent: tag.is_permanent })),
      flags: features.map((feature) => inventoryFlag(feature, reads, segments, fieldNames)),
    };
  }

  return {
    async run() {
      try {
        const inventory = await read();
        if (options.store.lastFailure() !== undefined) {
          options.logger.info('Sync from Flagsmith recovered');
        }
        options.store.replace(inventory);
        return inventory;
      } catch (error) {
        const failure =
          error instanceof FlagOpsError
            ? { at: now().toISOString(), code: error.code, message: error.message }
            : {
                at: now().toISOString(),
                code: 'internal_error' as const,
                message: 'The sync failed with an unexpected error; the log has its details.',
              };
        // Warn on the first failure of an outage only (architecture.md 18.2).
        if (options.store.lastFailure() === undefined) {
          options.logger.warn(
            { code: failure.code },
            `Sync from Flagsmith failed: ${failure.message}`,
          );
        }
        options.store.recordFailure(failure);
        throw error;
      }
    },
  };
}

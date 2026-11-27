import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { unexpectedResponse } from './errors.js';

const metadataItemSchema = z.object({ model_field: z.number().int(), field_value: z.string() });

const multivariateOptionSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  string_value: z.string().nullable(),
  integer_value: z.number().int().nullable(),
  boolean_value: z.boolean().nullable(),
  default_percentage_allocation: z.number(),
});

/** The fields of a feature that FlagOps reads, from the list and from the detail endpoint. */
const featureSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.enum(['STANDARD', 'MULTIVARIATE']),
  created_date: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.number().int()),
  is_archived: z.boolean(),
  is_server_key_only: z.boolean(),
  metadata: z.array(metadataItemSchema),
  multivariate_options: z.array(multivariateOptionSchema),
  owners: z.array(z.object({ id: z.number().int(), email: z.string() })),
  group_owners: z.array(z.object({ id: z.number().int(), name: z.string() })),
});

export type Feature = z.infer<typeof featureSchema>;

/** A feature as the list returns it with `environment=`: also the counts for that environment. */
const listedFeatureSchema = featureSchema.extend({
  num_segment_overrides: z.number().int(),
  /** Null on Edge projects; always a number on self-hosted ones. */
  num_identity_overrides: z.number().int().nullable(),
  last_modified_in_any_environment: z.string().nullable(),
  /** Only computed when the list is read for an environment. */
  lifecycle_stage: z.string().nullable().default(null),
  code_references_counts: z.array(
    z.object({ repository_url: z.string(), count: z.number().int() }),
  ),
});

export type ListedFeature = z.infer<typeof listedFeatureSchema>;

const featurePageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(listedFeatureSchema),
});

/**
 * Every feature of the project, archived ones included, with the counts for one environment when
 * one is given. Pages are read at the largest size Flagsmith allows, 999 (architecture.md 6.3).
 */
export async function listFeatures(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  environmentId: number | undefined,
): Promise<ListedFeature[]> {
  const path = '/api/v1/projects/{project_pk}/features/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: {
        path: { project_pk: projectId },
        query: {
          ...(environmentId === undefined ? {} : { environment: environmentId }),
          page,
          page_size: 999,
        },
      },
      headers: authHeaders(credential),
    });
    return parseResponse(client, featurePageSchema, data, { method: 'GET', path });
  });
}

const featureDetailPath = '/api/v1/projects/{project_pk}/features/{id}/';

export async function getFeature(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  ref: FeatureRef,
): Promise<Feature> {
  const { data } = await client.api.GET(featureDetailPath, {
    params: { path: { project_pk: ref.projectId, id: ref.featureId } },
    headers: authHeaders(credential),
  });
  return parseResponse(client, featureSchema, data, { method: 'GET', path: featureDetailPath });
}

export type NewFeature = {
  name: string;
  description: string;
  /** Multivariate when options are given; the control value is the feature's initial value. */
  initialValue: string | null;
  multivariateOptions: { stringValue: string; defaultPercentageAllocation: number }[];
};

/** Creates a feature. With the organisation key, Flagsmith adds no owner. */
export async function createFeature(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  feature: NewFeature,
): Promise<Feature> {
  client.writeGuard.checkProject(projectId);
  const path = '/api/v1/projects/{project_pk}/features/';
  const { data } = await client.api.POST(path, {
    params: { path: { project_pk: projectId } },
    body: {
      name: feature.name,
      description: feature.description,
      type: feature.multivariateOptions.length > 0 ? 'MULTIVARIATE' : 'STANDARD',
      default_enabled: false,
      initial_value: feature.initialValue,
      multivariate_options: feature.multivariateOptions.map((option) => ({
        type: 'unicode' as const,
        string_value: option.stringValue,
        default_percentage_allocation: option.defaultPercentageAllocation,
      })),
    },
    headers: authHeaders(credential),
  });
  return parseResponse(client, featureSchema, data, { method: 'POST', path });
}

export type FeatureRef = { projectId: number; featureId: number };

/**
 * A change to one feature. Only what is given changes:
 * - `metadata`: values by binding ID, where null removes the value;
 * - `tags`: tag IDs to remove, then tag IDs to add, so a caller replaces only its own tags;
 * - `description`: the new description, computed from the current one under the feature's lock.
 */
export type FeatureChange = {
  metadata?: ReadonlyMap<number, string | null>;
  tags?: { remove: readonly number[]; add: readonly number[] };
  description?: (current: string) => string;
  isArchived?: boolean;
};

/** Serialises FlagOps' own updates per feature, so they never overwrite each other (D-061). */
const featureLocks = new Map<number, Promise<void>>();

async function withFeatureLock<T>(featureId: number, task: () => Promise<T>): Promise<T> {
  const previous = featureLocks.get(featureId) ?? Promise.resolve();
  const run = previous.then(task);
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  featureLocks.set(featureId, done);
  try {
    return await run;
  } finally {
    if (featureLocks.get(featureId) === done) {
      featureLocks.delete(featureId);
    }
  }
}

type MergedFeature = {
  metadata: Map<number, string>;
  tags: number[];
  description: string;
  isArchived: boolean;
};

/** Flagsmith trims the description and each metadata value (architecture.md 6.5). */
function merge(current: Feature, change: FeatureChange): MergedFeature {
  const metadata = new Map(current.metadata.map((item) => [item.model_field, item.field_value]));
  for (const [bindingId, value] of change.metadata ?? []) {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') {
      metadata.delete(bindingId);
    } else {
      metadata.set(bindingId, trimmed);
    }
  }
  const tags = new Set(current.tags);
  for (const tagId of change.tags?.remove ?? []) {
    tags.delete(tagId);
  }
  for (const tagId of change.tags?.add ?? []) {
    tags.add(tagId);
  }
  const description = current.description ?? '';
  return {
    metadata,
    tags: [...tags].sort((a, b) => a - b),
    description:
      change.description === undefined ? description : change.description(description).trim(),
    isArchived: change.isArchived ?? current.is_archived,
  };
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.length === sortedB.length && sortedA.every((value, i) => value === sortedB[i]);
}

/** The fields the caller changed that the read-back does not show as sent. */
function unkeptFields(change: FeatureChange, sent: MergedFeature, readBack: Feature): string[] {
  const unkept: string[] = [];
  const stored = new Map(readBack.metadata.map((item) => [item.model_field, item.field_value]));
  for (const bindingId of change.metadata?.keys() ?? []) {
    if (stored.get(bindingId) !== sent.metadata.get(bindingId)) {
      unkept.push(`metadata ${bindingId}`);
    }
  }
  if (change.tags !== undefined && !sameNumbers(readBack.tags, sent.tags)) {
    unkept.push('tags');
  }
  if (change.description !== undefined && (readBack.description ?? '') !== sent.description) {
    unkept.push('description');
  }
  if (change.isArchived !== undefined && readBack.is_archived !== sent.isArchived) {
    unkept.push('is_archived');
  }
  return unkept;
}

/**
 * The only function that writes a feature (architecture.md 6.5, D-061). Flagsmith deletes every
 * metadata value an update leaves out, even on a PATCH without `metadata`, so this reads the
 * feature, merges the change, sends the full metadata and tag lists, and reads the feature back.
 * It holds a per-feature lock for the whole sequence, so concurrent FlagOps updates of one feature
 * all survive. Edits made in Flagsmith's dashboard at the same moment are not covered: Flagsmith
 * has no version check on this endpoint.
 */
export async function updateFeature(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  ref: FeatureRef,
  change: FeatureChange,
): Promise<Feature> {
  client.writeGuard.checkProject(ref.projectId);
  return withFeatureLock(ref.featureId, async () => {
    const current = await getFeature(client, credential, ref);
    const merged = merge(current, change);
    await client.api.PATCH(featureDetailPath, {
      params: { path: { project_pk: ref.projectId, id: ref.featureId } },
      body: {
        metadata: [...merged.metadata].map(([modelField, fieldValue]) => ({
          model_field: modelField,
          field_value: fieldValue,
        })),
        tags: merged.tags,
        ...(change.description === undefined ? {} : { description: merged.description }),
        ...(change.isArchived === undefined ? {} : { is_archived: merged.isArchived }),
      },
      headers: authHeaders(credential),
    });
    const readBack = await getFeature(client, credential, ref);
    const unkept = unkeptFields(change, merged, readBack);
    if (unkept.length > 0) {
      throw unexpectedResponse(
        { method: 'PATCH', path: featureDetailPath },
        `a feature that does not show the change just written to ${unkept.join(', ')} of ${current.name}`,
        client.observedVersion(),
      );
    }
    return readBack;
  });
}

import { FlagOpsError } from '@flagops/shared';
import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

/** The metadata fields that hold a flag's exit plan and cleanup PRs (architecture.md 5.7). */
const flagopsMetadataFields = {
  flagops_type: {
    type: 'str',
    description: 'FlagOps exit plan: release, experiment, ops or permission',
  },
  flagops_expires_at: {
    type: 'str',
    description: 'FlagOps exit plan: removal deadline, YYYY-MM-DD',
  },
  flagops_exit_plan: { type: 'multiline_str', description: 'FlagOps exit plan: removal steps' },
  flagops_cleanup_prs: {
    type: 'multiline_str',
    description: 'FlagOps: cleanup pull requests, one URL per line',
  },
} as const;

export type FlagopsFieldName = keyof typeof flagopsMetadataFields;

export const flagopsFieldNames = Object.keys(flagopsMetadataFields) as FlagopsFieldName[];

const contentTypeSchema = z.object({ id: z.number().int(), model: z.string() });

/** Content type IDs differ per instance (architecture.md 6.5), so FlagOps looks up the feature's. */
export async function featureContentTypeId(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  organisationId: number,
): Promise<number> {
  const path =
    '/api/v1/organisations/{organisation_pk}/metadata-model-fields/supported-content-types/';
  const { data } = await client.api.GET(path, {
    params: { path: { organisation_pk: String(organisationId) } },
    headers: authHeaders(credential),
  });
  const contentTypes = parseResponse(client, z.array(contentTypeSchema), data, {
    method: 'GET',
    path,
  });
  const feature = contentTypes.find((contentType) => contentType.model === 'feature');
  if (feature === undefined) {
    throw new FlagOpsError(
      'flagsmith_unexpected_response',
      'Flagsmith lists no feature content type for metadata, so FlagOps cannot store exit plans.',
    );
  }
  return feature.id;
}

const metadataFieldSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  organisation: z.number().int(),
  project: z.number().int().nullable(),
});

export type MetadataField = z.infer<typeof metadataFieldSchema>;

const metadataFieldPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(metadataFieldSchema),
});

/**
 * The project's own metadata fields, read without the `entity` filter: with `entity=feature`,
 * Flagsmith returns only fields already bound to features, which would hide a field that a failed
 * run created but never bound (architecture.md 6.5).
 */
export async function listProjectMetadataFields(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
): Promise<MetadataField[]> {
  const path = '/api/v1/projects/{project_pk}/metadata/fields/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { path: { project_pk: projectId }, query: { page, page_size: 999 } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, metadataFieldPageSchema, data, { method: 'GET', path });
  });
}

const bindingSchema = z.object({
  id: z.number().int(),
  field: z.number().int(),
  content_type: z.number().int(),
});

export type MetadataBinding = z.infer<typeof bindingSchema>;

const bindingPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(bindingSchema),
});

/**
 * The organisation's field bindings for one content type. This list pages at a fixed 10. Its
 * `content_type` filter is missing from the published schema, so the bindings are filtered here.
 */
export async function listMetadataBindings(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  organisationId: number,
  contentTypeId: number,
): Promise<MetadataBinding[]> {
  const path = '/api/v1/organisations/{organisation_pk}/metadata-model-fields/';
  const bindings = await readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { path: { organisation_pk: String(organisationId) }, query: { page } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, bindingPageSchema, data, { method: 'GET', path });
  });
  return bindings.filter((binding) => binding.content_type === contentTypeId);
}

/** Where each FlagOps field lives: its ID, and the ID of its binding to features. */
export type FlagopsFields = Record<FlagopsFieldName, { fieldId: number; bindingId: number }>;

export type MetadataSetup = { fields: FlagopsFields; created: string[]; bound: string[] };

/**
 * Makes sure the four FlagOps fields exist in the project and are bound to features. A run that
 * failed between creating a field and binding it repairs itself: the field is found by name and
 * only bound, because creating it again would break Flagsmith's unique (organisation, project,
 * name) constraint.
 */
export async function setupMetadataFields(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  scope: { organisationId: number; projectId: number },
): Promise<MetadataSetup> {
  const contentTypeId = await featureContentTypeId(client, credential, scope.organisationId);
  const existing = await listProjectMetadataFields(client, credential, scope.projectId);
  const bindings = await listMetadataBindings(
    client,
    credential,
    scope.organisationId,
    contentTypeId,
  );
  const created: string[] = [];
  const bound: string[] = [];
  const fields: Partial<FlagopsFields> = {};
  for (const name of flagopsFieldNames) {
    const definition = flagopsMetadataFields[name];
    let field = existing.find((item) => item.name === name && item.project === scope.projectId);
    if (field !== undefined && field.type !== definition.type) {
      throw new FlagOpsError(
        'flagsmith_validation',
        `The project's metadata field ${name} has the type ${field.type}, but FlagOps needs ${definition.type}. Rename or delete that field in Flagsmith.`,
      );
    }
    if (field === undefined) {
      field = await createMetadataField(client, credential, {
        name,
        type: definition.type,
        description: definition.description,
        organisation: scope.organisationId,
        project: scope.projectId,
      });
      created.push(name);
    }
    const fieldId = field.id;
    let binding = bindings.find((item) => item.field === fieldId);
    if (binding === undefined) {
      binding = await createMetadataBinding(client, credential, scope.organisationId, {
        field: fieldId,
        content_type: contentTypeId,
      });
      bound.push(name);
    }
    fields[name] = { fieldId, bindingId: binding.id };
  }
  return { fields: fields as FlagopsFields, created, bound };
}

async function createMetadataField(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  input: {
    name: string;
    type: (typeof flagopsMetadataFields)[FlagopsFieldName]['type'];
    description: string;
    organisation: number;
    project: number;
  },
): Promise<MetadataField> {
  const path = '/api/v1/metadata/fields/';
  const { data } = await client.api.POST(path, {
    body: input,
    headers: authHeaders(credential),
  });
  return parseResponse(client, metadataFieldSchema, data, { method: 'POST', path });
}

async function createMetadataBinding(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  organisationId: number,
  input: { field: number; content_type: number },
): Promise<MetadataBinding> {
  const path = '/api/v1/organisations/{organisation_pk}/metadata-model-fields/';
  const { data } = await client.api.POST(path, {
    params: { path: { organisation_pk: String(organisationId) } },
    body: { ...input, is_required_for: [] },
    headers: authHeaders(credential),
  });
  return parseResponse(client, bindingSchema, data, { method: 'POST', path });
}

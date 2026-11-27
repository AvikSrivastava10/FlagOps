import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

const identitySchema = z.object({ id: z.number().int(), identifier: z.string() });

export type Identity = z.infer<typeof identitySchema>;

const identityPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(identitySchema),
});

/** Every identity stored in the environment, read 999 at a time. */
export async function listIdentities(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  environmentKey: string,
): Promise<Identity[]> {
  const path = '/api/v1/environments/{environment_api_key}/identities/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: {
        path: { environment_api_key: environmentKey },
        query: { page, page_size: 999 },
      },
      headers: authHeaders(credential),
    });
    return parseResponse(client, identityPageSchema, data, { method: 'GET', path });
  });
}

export type TraitValue = string | number | boolean;

const traitSchema = z.object({
  trait_key: z.string(),
  value_type: z.enum(['int', 'unicode', 'bool', 'float']),
  integer_value: z.number().int().nullable(),
  string_value: z.string().nullable(),
  boolean_value: z.boolean().nullable(),
  float_value: z.number().nullable(),
});

const traitPageSchema = z.object({ next: z.string().nullable(), results: z.array(traitSchema) });

/** A stored trait's typed value, read from the column its `value_type` names. */
function traitValue(trait: z.infer<typeof traitSchema>): TraitValue | null {
  switch (trait.value_type) {
    case 'int':
      return trait.integer_value;
    case 'bool':
      return trait.boolean_value;
    case 'float':
      return trait.float_value;
    case 'unicode':
      return trait.string_value;
  }
}

/**
 * The traits of one identity. Flagsmith pages them at a fixed 10 and offers no page size, so each
 * identity costs at least one request (architecture.md 6.3). It answers 500 without credentials,
 * which is why FlagOps only calls it with the organisation key.
 */
export async function listTraits(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  environmentKey: string,
  identityId: number,
): Promise<Map<string, TraitValue | null>> {
  const path = '/api/v1/environments/{environment_api_key}/identities/{identity_pk}/traits/';
  const traits = await readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: {
        path: { environment_api_key: environmentKey, identity_pk: identityId },
        query: { page },
      },
      headers: authHeaders(credential),
    });
    return parseResponse(client, traitPageSchema, data, { method: 'GET', path });
  });
  return new Map(traits.map((trait) => [trait.trait_key, traitValue(trait)]));
}

export type TraitUpsert = { identifier: string; key: string; value: TraitValue | null };

/**
 * `PUT /api/v1/traits/bulk/` with the environment's client key: creates the identities it names
 * and sets their traits; a null value deletes the trait. It needs the organisation's
 * `persist_trait_data`.
 */
export async function upsertTraits(
  client: FlagsmithClient,
  environmentKey: string,
  traits: readonly TraitUpsert[],
): Promise<void> {
  client.writeGuard.checkEnvironment(environmentKey);
  await client.api.PUT('/api/v1/traits/bulk/', {
    body: traits.map((trait) => ({
      identity: { identifier: trait.identifier },
      trait_key: trait.key,
      // A null value is how the bulk endpoint deletes a trait; the schema types leave it out.
      trait_value: trait.value as TraitValue,
    })),
    headers: authHeaders({ kind: 'environment_key', key: environmentKey }),
  });
}

const identityOverrideSchema = z.object({
  id: z.number().int(),
  identity: identitySchema,
  enabled: z.boolean(),
  feature_state_value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
});

export type IdentityOverrideState = z.infer<typeof identityOverrideSchema>;

const identityOverridePageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(identityOverrideSchema),
});

/** The identity overrides of one feature in one environment. This list pages at a fixed 10. */
export async function listIdentityOverrides(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  environmentKey: string,
  featureId: number,
): Promise<IdentityOverrideState[]> {
  const path = '/api/v1/environments/{environment_api_key}/featurestates/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: {
        path: { environment_api_key: environmentKey },
        query: { anyIdentity: '1', feature: featureId, page },
      },
      headers: authHeaders(credential),
    });
    return parseResponse(client, identityOverridePageSchema, data, { method: 'GET', path });
  });
}

/**
 * Writes an identity override directly. Flagsmith allows this in v2 environments too, because
 * identity overrides are not versioned (`versioning_service.py` `require_direct_state_write`).
 */
export async function createIdentityOverride(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  environmentKey: string,
  identityId: number,
  state: { feature: number; enabled: boolean },
): Promise<void> {
  client.writeGuard.checkEnvironment(environmentKey);
  await client.api.POST(
    '/api/v1/environments/{environment_api_key}/identities/{identity_pk}/featurestates/',
    {
      params: { path: { environment_api_key: environmentKey, identity_pk: identityId } },
      body: state,
      headers: authHeaders(credential),
    },
  );
}

export async function updateIdentityOverride(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  environmentKey: string,
  override: { identityId: number; featureStateId: number; enabled: boolean },
): Promise<void> {
  client.writeGuard.checkEnvironment(environmentKey);
  await client.api.PATCH(
    '/api/v1/environments/{environment_api_key}/identities/{identity_pk}/featurestates/{id}/',
    {
      params: {
        path: {
          environment_api_key: environmentKey,
          identity_pk: override.identityId,
          id: override.featureStateId,
        },
      },
      body: { enabled: override.enabled },
      headers: authHeaders(credential),
    },
  );
}

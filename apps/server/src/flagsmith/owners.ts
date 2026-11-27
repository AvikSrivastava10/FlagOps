import { z } from 'zod';
import { parseResponse, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { unexpectedResponse } from './errors.js';
import type { FeatureRef } from './features.js';

/**
 * A feature's owners in Flagsmith (architecture.md 6.3, 8.5): users and permission groups. Each
 * write answers with the feature, which confirms the change before FlagOps reports it (6.6).
 */
export type OwnerChange = {
  kind: 'user' | 'group';
  action: 'add' | 'remove';
  ids: readonly number[];
};

const ownedFeatureSchema = z.object({
  owners: z.array(z.object({ id: z.number().int() })),
  group_owners: z.array(z.object({ id: z.number().int() })),
});

async function send(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  ref: FeatureRef,
  change: OwnerChange,
): Promise<{ data: unknown; path: string }> {
  const request = {
    params: { path: { project_pk: ref.projectId, id: ref.featureId } },
    headers: authHeaders(credential),
  };
  const users = { ...request, body: { user_ids: [...change.ids] } };
  const groups = { ...request, body: { group_ids: [...change.ids] } };
  if (change.kind === 'user') {
    const path =
      change.action === 'add'
        ? ('/api/v1/projects/{project_pk}/features/{id}/add-owners/' as const)
        : ('/api/v1/projects/{project_pk}/features/{id}/remove-owners/' as const);
    return { data: (await client.api.POST(path, users)).data, path };
  }
  const path =
    change.action === 'add'
      ? ('/api/v1/projects/{project_pk}/features/{id}/add-group-owners/' as const)
      : ('/api/v1/projects/{project_pk}/features/{id}/remove-group-owners/' as const);
  return { data: (await client.api.POST(path, groups)).data, path };
}

/** Adds or removes owners of one feature, and returns the owner IDs Flagsmith then holds. */
export async function changeOwners(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  ref: FeatureRef,
  change: OwnerChange,
): Promise<number[]> {
  client.writeGuard.checkProject(ref.projectId);
  const { data, path } = await send(client, credential, ref, change);
  const feature = parseResponse(client, ownedFeatureSchema, data, { method: 'POST', path });
  const held = (change.kind === 'user' ? feature.owners : feature.group_owners).map(
    (owner) => owner.id,
  );
  const confirmed = change.ids.every((id) => held.includes(id) === (change.action === 'add'));
  if (!confirmed) {
    throw unexpectedResponse(
      { method: 'POST', path },
      `a feature whose ${change.kind} owners do not show the change just made`,
      client.observedVersion(),
    );
  }
  return held;
}

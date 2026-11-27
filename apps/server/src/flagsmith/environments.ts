import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

const environmentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** The client key: public by design, and part of Flagsmith's own dashboard URLs. */
  api_key: z.string(),
  project: z.number().int(),
  /** Change requests block writes whenever this is not null, including 0 (architecture.md 6.5). */
  minimum_change_request_approvals: z.number().int().nullable(),
  /** Overrides the project's value when not null (architecture.md 6.5). */
  hide_disabled_flags: z.boolean().nullable(),
  use_v2_feature_versioning: z.boolean(),
  use_identity_overrides_in_local_eval: z.boolean(),
  use_identity_composite_key_for_hashing: z.boolean(),
});

export type Environment = z.infer<typeof environmentSchema>;

const environmentPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(environmentSchema),
});

/** `GET /api/v1/environments/?project=`, which pages at a fixed 10 (architecture.md 6.3). */
export async function listEnvironments(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
): Promise<Environment[]> {
  const path = '/api/v1/environments/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { query: { project: projectId, page } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, environmentPageSchema, data, { method: 'GET', path });
  });
}

/** `GET /api/v1/environments/{api_key}/`, with the settings that decide how FlagOps may write. */
export async function getEnvironment(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  apiKey: string,
): Promise<Environment> {
  const path = '/api/v1/environments/{api_key}/';
  const { data } = await client.api.GET(path, {
    params: { path: { api_key: apiKey } },
    headers: authHeaders(credential),
  });
  return parseResponse(client, environmentSchema, data, { method: 'GET', path });
}

export async function createEnvironment(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  input: { name: string; project: number },
): Promise<Environment> {
  client.writeGuard.checkProject(input.project);
  const path = '/api/v1/environments/';
  const { data } = await client.api.POST(path, {
    body: { name: input.name, project: input.project },
    headers: authHeaders(credential),
  });
  return parseResponse(client, environmentSchema, data, { method: 'POST', path });
}

/**
 * `POST /api/v1/environments/{api_key}/enable-v2-versioning/`. Flagsmith answers 202 and switches
 * the environment over in a background task, so callers poll `use_v2_feature_versioning`.
 */
export async function enableV2Versioning(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  apiKey: string,
): Promise<void> {
  client.writeGuard.checkEnvironment(apiKey);
  await client.api.POST('/api/v1/environments/{api_key}/enable-v2-versioning/', {
    params: { path: { api_key: apiKey } },
    headers: authHeaders(credential),
  });
}

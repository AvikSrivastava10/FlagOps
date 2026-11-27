import { FlagOpsError } from '@flagops/shared';
import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

const organisationSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** The caller's role; present when a user lists their organisations. */
  role: z.string().optional(),
});

export type Organisation = z.infer<typeof organisationSchema>;

const organisationPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(organisationSchema),
});

/** `GET /api/v1/organisations/`: the organisations the credential belongs to, with the user's role. */
export async function listOrganisations(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
): Promise<Organisation[]> {
  const path = '/api/v1/organisations/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { query: { page } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, organisationPageSchema, data, { method: 'GET', path });
  });
}

/**
 * The organisation that owns the API key. An organisation key lists exactly its own organisation
 * (architecture.md 6.3), so anything else means the key is not an organisation key.
 */
export async function organisationOfKey(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
): Promise<Organisation> {
  const organisations = await listOrganisations(client, credential);
  const [organisation] = organisations;
  if (organisation === undefined || organisations.length > 1) {
    throw new FlagOpsError(
      'flagsmith_auth_failed',
      `FLAGSMITH_ORG_API_KEY gives access to ${organisations.length} organisations instead of one. Use an API key created in the organisation FlagOps manages.`,
    );
  }
  return organisation;
}

const projectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  organisation: z.number().int(),
  hide_disabled_flags: z.boolean(),
  stale_flags_limit_days: z.number().int(),
});

export type Project = z.infer<typeof projectSchema>;

/**
 * `GET /api/v1/projects/`: every project the credential can see, as one unpaged list, with the
 * project settings FlagOps reads (`hide_disabled_flags`, `stale_flags_limit_days`).
 */
export async function listProjects(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
): Promise<Project[]> {
  const path = '/api/v1/projects/';
  const { data } = await client.api.GET(path, { headers: authHeaders(credential) });
  return parseResponse(client, z.array(projectSchema), data, { method: 'GET', path });
}

/**
 * The organisation of the key, looked up once: it cannot change while the process runs. A failed
 * lookup is not remembered, so the next caller tries again.
 */
export function keyOrganisationResolver(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
): () => Promise<Organisation> {
  let organisation: Organisation | undefined;
  return async () => (organisation ??= await organisationOfKey(client, credential));
}

/** `POST /api/v1/projects/`. Open-source Flagsmith allows one project per organisation. */
export async function createProject(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  input: { name: string; organisation: number },
): Promise<Project> {
  const path = '/api/v1/projects/';
  const { data } = await client.api.POST(path, {
    body: { name: input.name, organisation: input.organisation },
    headers: authHeaders(credential),
  });
  return parseResponse(client, projectSchema, data, { method: 'POST', path });
}

import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

/**
 * The organisation's users and permission groups, which CODEOWNERS owners map onto
 * (architecture.md 6.3, 8.5). Read with the organisation key.
 */
const userSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

export type OrganisationUser = z.infer<typeof userSchema>;

const groupSchema = z.object({ id: z.number().int(), name: z.string() });

export type OrganisationGroup = z.infer<typeof groupSchema>;

/** `GET /api/v1/organisations/{id}/users/`: one unpaged list on 2.295.2 (checked live). */
export async function listOrganisationUsers(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  organisationId: number,
): Promise<OrganisationUser[]> {
  const path = '/api/v1/organisations/{organisation_pk}/users/';
  const { data } = await client.api.GET(path, {
    params: { path: { organisation_pk: String(organisationId) } },
    headers: authHeaders(credential),
  });
  return parseResponse(client, z.array(userSchema), data, { method: 'GET', path });
}

const groupPageSchema = z.object({ next: z.string().nullable(), results: z.array(groupSchema) });

/** `GET /api/v1/organisations/{id}/groups/`, which pages at a fixed 10. */
export async function listOrganisationGroups(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  organisationId: number,
): Promise<OrganisationGroup[]> {
  const path = '/api/v1/organisations/{organisation_pk}/groups/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { path: { organisation_pk: organisationId }, query: { page } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, groupPageSchema, data, { method: 'GET', path });
  });
}

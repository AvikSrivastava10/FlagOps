import { FlagOpsError, type Directory } from '@flagops/shared';
import { appendAudit, type AuditActor } from '../audit/audit.js';
import type { Db } from '../db/connection.js';
import { listOwnerMappings, replaceOwnerMappings, type OwnerMapping } from '../db/repos/owners.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import { listOrganisationGroups, listOrganisationUsers } from '../flagsmith/directory.js';
import type { Organisation } from '../flagsmith/projects.js';
import { handleKey } from './sync.js';

/**
 * The operator's owner mappings (architecture.md 8.5, 15): which Flagsmith user or group each
 * CODEOWNERS owner is. Every mapped ID must be listed in the organisation's directory.
 */
export type OwnerMappingDeps = {
  db: Db;
  client: FlagsmithClient;
  /** The organisation key, which lists the organisation's users and groups. */
  credential: FlagsmithCredential;
  keyOrganisation: () => Promise<Organisation>;
};

export async function readDirectory(deps: OwnerMappingDeps): Promise<Directory> {
  const organisation = await deps.keyOrganisation();
  const [users, groups] = await Promise.all([
    listOrganisationUsers(deps.client, deps.credential, organisation.id),
    listOrganisationGroups(deps.client, deps.credential, organisation.id),
  ]);
  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    })),
    groups: groups.map((group) => ({ id: group.id, name: group.name })),
  };
}

function invalid(message: string): FlagOpsError {
  return new FlagOpsError('validation_failed', message);
}

/** Replaces the mappings after checking them against the directory, and audits the change. */
export async function saveOwnerMappings(
  deps: OwnerMappingDeps,
  mappings: readonly OwnerMapping[],
  actor: AuditActor,
): Promise<OwnerMapping[]> {
  const handles = mappings.map((mapping) => handleKey(mapping.github));
  const repeated = handles.find((handle, index) => handles.indexOf(handle) !== index);
  if (repeated !== undefined) {
    throw invalid(`@${repeated} is mapped more than once.`);
  }
  const directory = await readDirectory(deps);
  for (const mapping of mappings) {
    const known =
      mapping.kind === 'user'
        ? directory.users.some((user) => user.id === mapping.flagsmithUserId)
        : directory.groups.some((group) => group.id === mapping.flagsmithGroupId);
    if (!known) {
      throw invalid(
        mapping.kind === 'user'
          ? `${mapping.github} maps to Flagsmith user ${mapping.flagsmithUserId}, which the organisation does not have.`
          : `${mapping.github} maps to Flagsmith group ${mapping.flagsmithGroupId}, which the organisation does not have.`,
      );
    }
  }
  replaceOwnerMappings(deps.db, mappings);
  appendAudit(deps.db, {
    actor,
    action: 'owner_mappings.save',
    outcome: 'succeeded',
    details: { mappings: mappings.length },
  });
  return listOwnerMappings(deps.db);
}

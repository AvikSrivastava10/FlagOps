import { flagTypes, permanentFlagTypes, type FlagType } from '@flagops/shared';
import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { unexpectedResponse } from './errors.js';

const tagSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  is_permanent: z.boolean(),
});

export type Tag = z.infer<typeof tagSchema>;

const tagPageSchema = z.object({ next: z.string().nullable(), results: z.array(tagSchema) });

/** The project's tags. This list pages at a fixed 10 (architecture.md 6.3). */
export async function listTags(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
): Promise<Tag[]> {
  const path = '/api/v1/projects/{project_pk}/tags/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: { path: { project_pk: projectId }, query: { page } },
      headers: authHeaders(credential),
    });
    return parseResponse(client, tagPageSchema, data, { method: 'GET', path });
  });
}

/** The visible type tag of each exit-plan type, coloured like the UI's route bullets. */
const typeTagColours: Readonly<Record<FlagType, string>> = {
  release: '#00733A',
  experiment: '#FF6319',
  ops: '#C8102E',
  permission: '#B933AD',
};

function typeTagLabel(type: FlagType): string {
  return `type:${type}`;
}

/** Ops and permission tags are permanent, so Flagsmith's own lifecycle counts those flags as permanent. */
function isPermanentType(type: FlagType): boolean {
  return permanentFlagTypes.includes(type);
}

export type TypeTagIds = Partial<Record<FlagType, number>>;

export type TypeTagSetup = {
  /** The tag FlagOps owns for each type it could settle. */
  tagIds: TypeTagIds;
  created: FlagType[];
  corrected: FlagType[];
  /** Types left without a tag, each with the reason, for the status page. */
  problems: string[];
};

/**
 * Settles which tag FlagOps owns for each type (architecture.md 5.7). Flagsmith keeps tag labels
 * unique only among system tags, so FlagOps identifies its tags by the IDs it recorded:
 * - a recorded tag that still exists is kept, and its `is_permanent` is corrected when wrong;
 * - without a recorded tag, no tag with the label means a new one, and exactly one with the right
 *   `is_permanent` is adopted. Several, or one with the wrong `is_permanent`, belong to someone
 *   else, so nothing is written for that type and the problem is reported.
 */
export async function setupTypeTags(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  recorded: TypeTagIds,
): Promise<TypeTagSetup> {
  client.writeGuard.checkProject(projectId);
  const tags = await listTags(client, credential, projectId);
  const setup: TypeTagSetup = { tagIds: {}, created: [], corrected: [], problems: [] };
  for (const type of flagTypes) {
    const label = typeTagLabel(type);
    const permanent = isPermanentType(type);
    const own = tags.find((tag) => tag.id === recorded[type]);
    if (own !== undefined) {
      if (own.is_permanent !== permanent) {
        await patchTagPermanence(client, credential, projectId, own.id, permanent);
        setup.corrected.push(type);
      }
      setup.tagIds[type] = own.id;
      continue;
    }
    const sameLabel = tags.filter((tag) => tag.label === label);
    const [only] = sameLabel;
    if (only === undefined) {
      const tag = await createTag(client, credential, projectId, {
        label,
        color: typeTagColours[type],
        description: `FlagOps exit plan type: ${type}`,
        is_permanent: permanent,
      });
      setup.tagIds[type] = tag.id;
      setup.created.push(type);
    } else if (sameLabel.length > 1) {
      setup.problems.push(
        `The project has ${sameLabel.length} tags labelled ${label}, so FlagOps does not know which is its own. Remove the duplicates in Flagsmith.`,
      );
    } else if (only.is_permanent !== permanent) {
      setup.problems.push(
        `The tag ${label} has "permanent" set to ${only.is_permanent}, but FlagOps needs ${permanent}. Change it in Flagsmith, or rename it so FlagOps creates its own.`,
      );
    } else {
      setup.tagIds[type] = only.id;
    }
  }
  return setup;
}

async function createTag(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  input: { label: string; color: string; description: string; is_permanent: boolean },
): Promise<Tag> {
  const path = '/api/v1/projects/{project_pk}/tags/';
  const { data } = await client.api.POST(path, {
    params: { path: { project_pk: projectId } },
    body: input,
    headers: authHeaders(credential),
  });
  return parseResponse(client, tagSchema, data, { method: 'POST', path });
}

async function patchTagPermanence(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  tagId: number,
  isPermanent: boolean,
): Promise<void> {
  const path = '/api/v1/projects/{project_pk}/tags/{id}/';
  const { data } = await client.api.PATCH(path, {
    params: { path: { project_pk: projectId, id: tagId } },
    body: { is_permanent: isPermanent },
    headers: authHeaders(credential),
  });
  const tag = parseResponse(client, tagSchema, data, { method: 'PATCH', path });
  // The answer is the stored tag, which confirms the change (architecture.md 6.6).
  if (tag.is_permanent !== isPermanent) {
    throw unexpectedResponse(
      { method: 'PATCH', path },
      `a tag whose is_permanent is still ${tag.is_permanent}`,
      client.observedVersion(),
    );
  }
}

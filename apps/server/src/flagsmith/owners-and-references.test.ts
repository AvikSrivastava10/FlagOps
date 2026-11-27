import { FlagOpsError } from '@flagops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { addSmallProject, manageSmallProject, small } from '../../test/helpers/fake-project.js';
import type { FlagsmithClient } from './client.js';
import { uploadCodeReferences } from './code-references.js';
import { listOrganisationGroups, listOrganisationUsers } from './directory.js';
import { changeOwners } from './owners.js';

let fake: FakeFlagsmith;
let client: FlagsmithClient;
const ref = { projectId: small.projectId, featureId: small.standardFeatureId };

beforeEach(() => {
  ({ fake, client } = fakeClient());
  addSmallProject(fake);
  manageSmallProject(fake, client);
});

async function errorOf(promise: Promise<unknown>): Promise<FlagOpsError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof FlagOpsError)) {
    throw new Error(`expected a FlagOpsError, got ${String(error)}`);
  }
  return error;
}

describe('changeOwners', () => {
  it('adds and removes user and group owners, confirming each change in the answer', async () => {
    expect(
      await changeOwners(client, organisationKey, ref, {
        kind: 'user',
        action: 'add',
        ids: [7, 8],
      }),
    ).toEqual([7, 8]);
    expect(
      await changeOwners(client, organisationKey, ref, { kind: 'group', action: 'add', ids: [3] }),
    ).toEqual([3]);
    expect(
      await changeOwners(client, organisationKey, ref, {
        kind: 'user',
        action: 'remove',
        ids: [7],
      }),
    ).toEqual([8]);
  });

  it('reports flagsmith_unexpected_response when the answer does not show the change', async () => {
    const originalFetch = fake.fetch;
    fake.fetch = async (request) =>
      request.url.includes('add-owners')
        ? Response.json({ owners: [], group_owners: [] })
        : originalFetch(request);
    ({ client } = fakeClient(fake));
    manageSmallProject(fake, client);

    const error = await errorOf(
      changeOwners(client, organisationKey, ref, { kind: 'user', action: 'add', ids: [7] }),
    );

    expect(error.code).toBe('flagsmith_unexpected_response');
  });
});

describe('uploadCodeReferences', () => {
  const upload = {
    repositoryUrl: 'https://github.com/acme/shop',
    revision: 'a'.repeat(40),
    references: [
      { featureName: 'gift_wrap', filePath: 'src/a.ts', lineNumber: 3 },
      { featureName: 'gift_wrap', filePath: 'src/b.ts', lineNumber: 9 },
    ],
  };

  it('uploads the scan and confirms the counts on the feature list', async () => {
    await uploadCodeReferences(client, organisationKey, small.projectId, upload);

    expect(fake.state.codeReferenceScans).toHaveLength(1);
    expect(fake.state.codeReferenceScans[0]?.references).toHaveLength(2);
  });

  it('reports a feature list that does not show the uploaded counts', async () => {
    const originalFetch = fake.fetch;
    // Flagsmith answers the upload but stores nothing.
    fake.fetch = async (request) =>
      request.method === 'POST' && request.url.includes('code-references')
        ? Response.json(
            { repository_url: upload.repositoryUrl, revision: upload.revision },
            { status: 201 },
          )
        : originalFetch(request);
    ({ client } = fakeClient(fake));
    manageSmallProject(fake, client);

    const error = await errorOf(
      uploadCodeReferences(client, organisationKey, small.projectId, upload),
    );

    expect(error.code).toBe('flagsmith_unexpected_response');
    expect(error.message).toContain('gift_wrap');
  });
});

describe('the organisation directory', () => {
  it('lists the users, and the groups across pages of 10', async () => {
    fake.state.users.push({
      id: 7,
      email: 'operator@example.com',
      password: 'unused',
      firstName: 'Demo',
      lastName: 'Operator',
      roles: { 1: 'ADMIN' },
    });
    for (let index = 1; index <= 11; index += 1) {
      fake.state.groups.push({ id: index, organisation: 1, name: `group-${index}` });
    }

    expect(await listOrganisationUsers(client, organisationKey, 1)).toEqual([
      { id: 7, email: 'operator@example.com', first_name: 'Demo', last_name: 'Operator' },
    ]);
    expect(await listOrganisationGroups(client, organisationKey, 1)).toHaveLength(11);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { addSmallProject, manageSmallProject, small } from '../../test/helpers/fake-project.js';
import type { FlagsmithClient } from './client.js';
import { createIdentityOverride, updateIdentityOverride } from './identities-api.js';

let fake: FakeFlagsmith;
let client: FlagsmithClient;
const identityId = 70;

beforeEach(() => {
  ({ fake, client } = fakeClient());
  addSmallProject(fake);
  manageSmallProject(fake, client);
  fake.state.identities.push({
    id: identityId,
    environment: small.environmentKey,
    identifier: 'user-0001',
    traits: new Map(),
  });
});

/** The fake answers `method` writes with `answer`, as a Flagsmith that stored something else would. */
function answerWritesWith(method: string, answer: object): void {
  const originalFetch = fake.fetch;
  fake.fetch = async (request) =>
    request.method === method && request.url.includes('/featurestates/')
      ? Response.json(answer, { status: method === 'POST' ? 201 : 200 })
      : originalFetch(request);
  ({ client } = fakeClient(fake));
  manageSmallProject(fake, client);
}

describe('identity override writes', () => {
  it('create and update the override, each confirmed by the state Flagsmith answers with', async () => {
    await createIdentityOverride(client, organisationKey, small.environmentKey, identityId, {
      feature: small.standardFeatureId,
      enabled: true,
    });
    await updateIdentityOverride(client, organisationKey, small.environmentKey, {
      identityId,
      featureStateId: fake.state.identityOverrides[0]?.id ?? 0,
      enabled: false,
    });

    expect(fake.state.identityOverrides).toMatchObject([
      { identity: identityId, feature: small.standardFeatureId, enabled: false },
    ]);
  });

  it('reports a create whose answer differs from the override just written', async () => {
    answerWritesWith('POST', {
      id: 1,
      feature: small.standardFeatureId,
      identity: identityId,
      enabled: false,
    });

    await expect(
      createIdentityOverride(client, organisationKey, small.environmentKey, identityId, {
        feature: small.standardFeatureId,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'flagsmith_unexpected_response' });
  });

  it('reports an update whose answer still shows the old state', async () => {
    answerWritesWith('PATCH', {
      id: 1,
      feature: small.standardFeatureId,
      identity: identityId,
      enabled: true,
    });

    await expect(
      updateIdentityOverride(client, organisationKey, small.environmentKey, {
        identityId,
        featureStateId: 1,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'flagsmith_unexpected_response' });
  });
});

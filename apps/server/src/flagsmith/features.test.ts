import { FlagOpsError } from '@flagops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { addSmallProject, manageSmallProject, small } from '../../test/helpers/fake-project.js';
import type { FlagsmithClient } from './client.js';
import { getFeature, updateFeature } from './features.js';

const ref = { projectId: small.projectId, featureId: small.standardFeatureId };
const line = 'FlagOps: release · remove by 2026-12-31';

let fake: FakeFlagsmith;
let client: FlagsmithClient;

beforeEach(() => {
  ({ fake, client } = fakeClient());
  addSmallProject(fake);
  manageSmallProject(fake, client);
});

function giftWrap() {
  const feature = fake.state.features.find((item) => item.id === small.standardFeatureId);
  if (feature === undefined) {
    throw new Error('the small project has no gift_wrap');
  }
  return feature;
}

function patchBodies(): Record<string, unknown>[] {
  return fake
    .writes()
    .filter((request) => request.method === 'PATCH')
    .map((request) => request.body as Record<string, unknown>);
}

describe('updateFeature', () => {
  it('sends the full metadata and tag lists, so a change never drops the other values', async () => {
    giftWrap().metadata = [{ model_field: small.stepsBindingId, field_value: 'Remove it.' }];
    giftWrap().tags = [3];

    await updateFeature(client, organisationKey, ref, {
      metadata: new Map([[small.typeBindingId, 'release']]),
    });

    expect(patchBodies()).toEqual([
      {
        metadata: [
          { model_field: small.stepsBindingId, field_value: 'Remove it.' },
          { model_field: small.typeBindingId, field_value: 'release' },
        ],
        tags: [3],
      },
    ]);
    expect(giftWrap().metadata).toHaveLength(2);
  });

  it('removes a metadata value given as null, and replaces only the tags it is told to', async () => {
    giftWrap().metadata = [
      { model_field: small.typeBindingId, field_value: 'release' },
      { model_field: small.stepsBindingId, field_value: 'Remove it.' },
    ];
    giftWrap().tags = [1, 3];

    const updated = await updateFeature(client, organisationKey, ref, {
      metadata: new Map([[small.stepsBindingId, null]]),
      tags: { remove: [1, 2], add: [2] },
    });

    expect(updated.metadata).toEqual([
      expect.objectContaining({ model_field: small.typeBindingId, field_value: 'release' }),
    ]);
    expect(updated.tags).toEqual([2, 3]);
  });

  it('keeps both of two concurrent updates of one feature: a metadata value and the description line', async () => {
    await Promise.all([
      updateFeature(client, organisationKey, ref, {
        metadata: new Map([[small.typeBindingId, 'release']]),
      }),
      updateFeature(client, organisationKey, ref, {
        description: (current) => `${current}\n${line}`,
      }),
    ]);

    const feature = await getFeature(client, organisationKey, ref);
    expect(feature.metadata).toEqual([
      expect.objectContaining({ model_field: small.typeBindingId, field_value: 'release' }),
    ]);
    expect(feature.description).toBe(`Gift wrapping at checkout.\n${line}`);
  });

  it('runs the next update after a failed one', async () => {
    fake.failNext(/\/features\/20\/$/, 500);
    fake.failNext(/\/features\/20\/$/, 500);
    fake.failNext(/\/features\/20\/$/, 500);

    const results = await Promise.allSettled([
      updateFeature(client, organisationKey, ref, { isArchived: true }),
      updateFeature(client, organisationKey, ref, { isArchived: true }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(giftWrap().is_archived).toBe(true);
  });

  it('reports flagsmith_unexpected_response when the read-back does not show the change', async () => {
    const originalFetch = fake.fetch;
    // Flagsmith accepts the PATCH but stores nothing.
    fake.fetch = async (request) =>
      request.method === 'PATCH' ? Response.json({}, { status: 200 }) : originalFetch(request);
    ({ client } = fakeClient(fake));
    manageSmallProject(fake, client);

    const error: unknown = await updateFeature(client, organisationKey, ref, {
      metadata: new Map([[small.typeBindingId, 'release']]),
      isArchived: true,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FlagOpsError);
    expect((error as FlagOpsError).code).toBe('flagsmith_unexpected_response');
    expect((error as FlagOpsError).message).toContain(
      `metadata ${small.typeBindingId}, is_archived`,
    );
  });

  it('sends trimmed values and a description without a leading newline, as Flagsmith stores them (round 3 #2)', async () => {
    giftWrap().description = '';

    // A careless caller that appends to the empty description and ends in a newline.
    const updated = await updateFeature(client, organisationKey, ref, {
      metadata: new Map([[small.stepsBindingId, 'Remove the flag.\n']]),
      description: (current) => `${current}\n${line}\n`,
    });

    expect(patchBodies()[0]).toMatchObject({
      metadata: [{ model_field: small.stepsBindingId, field_value: 'Remove the flag.' }],
      description: line,
    });
    expect(updated.description).toBe(line);
  });
});

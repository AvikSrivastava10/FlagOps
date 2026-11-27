import { FlagOpsError } from '@flagops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { addSmallProject, manageSmallProject, small } from '../../test/helpers/fake-project.js';
import type { FlagsmithClient } from './client.js';
import { checkPutBody, getFlag, putFlag, type FlagApiBody } from './flag-api.js';

const listed = new Set<number>([small.userSegmentId]);
const target = { environmentKey: small.environmentKey, featureId: small.standardFeatureId };

let fake: FakeFlagsmith;
let client: FlagsmithClient;

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

const onForBetaTesters: FlagApiBody = {
  environment_default: { enabled: false, value: null },
  segment_overrides: [
    { segment: { id: small.userSegmentId }, priority: 0, enabled: true, value: null },
  ],
};

describe('checkPutBody', () => {
  it('refuses an override on a system segment, before anything is sent', () => {
    expect(() =>
      checkPutBody(
        {
          environment_default: { enabled: true, value: null },
          segment_overrides: [
            { segment: { id: small.systemSegmentId }, priority: 0, enabled: false, value: null },
          ],
        },
        listed,
      ),
    ).toThrow(/segment 11 is a system segment/);
  });

  it('refuses an override without an explicit priority', () => {
    expect(() =>
      checkPutBody(
        {
          environment_default: { enabled: true, value: null },
          segment_overrides: [{ segment: { id: small.userSegmentId }, enabled: true, value: null }],
        },
        listed,
      ),
    ).toThrow(/every segment override needs an explicit priority/);
  });

  it('accepts a body without variant lists, as standard flags need', () => {
    expect(checkPutBody(onForBetaTesters, listed)).toEqual(onForBetaTesters);
  });
});

describe('putFlag', () => {
  it('replaces the configuration and returns the read-back', async () => {
    const readBack = await putFlag(client, organisationKey, target, onForBetaTesters, listed);

    expect(readBack).toEqual({
      environment_default: { enabled: false, value: null, variants: [] },
      segment_overrides: [
        {
          segment: { id: small.userSegmentId },
          priority: 0,
          enabled: true,
          value: null,
          variants: [],
        },
      ],
    });
    expect(await getFlag(client, organisationKey, target)).toEqual(readBack);
  });

  it('writes a multivariate flag with every variant weighted', async () => {
    const readBack = await putFlag(
      client,
      organisationKey,
      { environmentKey: small.environmentKey, featureId: small.multivariateFeatureId },
      {
        environment_default: {
          enabled: true,
          value: { type: 'string', value: 'control' },
          variants: [{ id: small.optionId, weight: 50 }],
        },
        segment_overrides: [],
      },
      listed,
    );

    expect(readBack.environment_default.variants).toEqual([{ id: small.optionId, weight: 50 }]);
  });

  it.each([0, 2])(
    'refuses, without writing, when the environment requires change requests (%i approvals)',
    async (approvals) => {
      const environment = fake.state.environments[0];
      if (environment !== undefined) {
        environment.minimum_change_request_approvals = approvals;
      }

      const error = await errorOf(
        putFlag(client, organisationKey, target, onForBetaTesters, listed),
      );

      expect(error.code).toBe('flagsmith_change_requests_enabled');
      expect(fake.writes()).toEqual([]);
    },
  );

  it('reports flagsmith_unexpected_response when the read-back does not serve what was sent', async () => {
    const originalFetch = fake.fetch;
    // Flagsmith accepts the PUT but keeps serving the old configuration.
    fake.fetch = async (request) =>
      request.method === 'PUT' ? Response.json({}, { status: 200 }) : originalFetch(request);
    ({ client } = fakeClient(fake));
    manageSmallProject(fake, client);

    const error = await errorOf(putFlag(client, organisationKey, target, onForBetaTesters, listed));

    expect(error.code).toBe('flagsmith_unexpected_response');
    expect(error.message).toContain('does not serve the configuration just written in Development');
  });
});

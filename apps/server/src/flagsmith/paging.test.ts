import { describe, expect, it } from 'vitest';
import { featureContentTypeId } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { listEnvironments } from './environments.js';
import { listMetadataBindings } from './metadata.js';
import { listTags } from './tags.js';

/**
 * Tags, environments and metadata bindings page at a fixed 10 and accept only `page`
 * (DRF's default pagination, `api/app/settings/common.py:373,379`). Round 3 #1.
 */
describe('lists that page at a fixed 10', () => {
  function elevenOfEach() {
    const { fake, client } = fakeClient();
    const ids = Array.from({ length: 11 }, (_, index) => index + 1);
    fake.state.projects.push({
      id: 1,
      name: 'Shop',
      organisation: 1,
      hide_disabled_flags: false,
      stale_flags_limit_days: 30,
    });
    for (const id of ids) {
      fake.state.environments.push({
        id,
        name: `Environment ${id}`,
        api_key: `key-${id}`,
        project: 1,
        minimum_change_request_approvals: null,
        hide_disabled_flags: null,
        use_v2_feature_versioning: true,
        use_identity_overrides_in_local_eval: true,
        use_identity_composite_key_for_hashing: true,
      });
      fake.state.tags.push({
        id,
        project: 1,
        label: `tag-${id}`,
        color: '#000000',
        is_permanent: false,
      });
      fake.state.bindings.push({ id, field: id, content_type: featureContentTypeId });
    }
    return { fake, client };
  }

  it('reads all 11 environments, tags and metadata bindings, following next', async () => {
    const { fake, client } = elevenOfEach();

    expect(await listEnvironments(client, organisationKey, 1)).toHaveLength(11);
    expect(await listTags(client, organisationKey, 1)).toHaveLength(11);
    expect(
      await listMetadataBindings(client, organisationKey, 1, featureContentTypeId),
    ).toHaveLength(11);
    const pagesRead = fake.requests.map(
      (request) => `${request.path} ${request.query.get('page')}`,
    );
    expect(pagesRead).toEqual([
      '/api/v1/environments/ 1',
      '/api/v1/environments/ 2',
      '/api/v1/projects/1/tags/ 1',
      '/api/v1/projects/1/tags/ 2',
      '/api/v1/organisations/1/metadata-model-fields/ 1',
      '/api/v1/organisations/1/metadata-model-fields/ 2',
    ]);
    expect(fake.requests.every((request) => !request.query.has('page_size'))).toBe(true);
  });
});

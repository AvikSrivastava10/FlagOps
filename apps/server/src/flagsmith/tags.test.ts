import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import type { FlagsmithClient } from './client.js';
import { setupTypeTags } from './tags.js';

let fake: FakeFlagsmith;
let client: FlagsmithClient;

beforeEach(() => {
  ({ fake, client } = fakeClient());
});

function addTag(id: number, label: string, isPermanent: boolean): void {
  fake.state.tags.push({ id, project: 1, label, color: '#000000', is_permanent: isPermanent });
}

describe('setupTypeTags', () => {
  it('creates a missing tag for each type and records its ID; ops and permission are permanent', async () => {
    const setup = await setupTypeTags(client, organisationKey, 1, {});

    expect(setup.created).toEqual(['release', 'experiment', 'ops', 'permission']);
    expect(setup.problems).toEqual([]);
    expect(fake.state.tags.map((tag) => [tag.label, tag.is_permanent])).toEqual([
      ['type:release', false],
      ['type:experiment', false],
      ['type:ops', true],
      ['type:permission', true],
    ]);
    expect(setup.tagIds).toEqual({
      release: fake.state.tags[0]?.id,
      experiment: fake.state.tags[1]?.id,
      ops: fake.state.tags[2]?.id,
      permission: fake.state.tags[3]?.id,
    });
  });

  it('reuses a single same-label tag only when its is_permanent matches', async () => {
    addTag(1, 'type:release', false);
    addTag(2, 'type:ops', true);

    const setup = await setupTypeTags(client, organisationKey, 1, {});

    expect(setup.tagIds).toMatchObject({ release: 1, ops: 2 });
    expect(setup.created).toEqual(['experiment', 'permission']);
  });

  it('reports a same-label tag with the wrong is_permanent, and duplicates, without writing for them', async () => {
    addTag(1, 'type:ops', false);
    addTag(2, 'type:release', false);
    addTag(3, 'type:release', false);

    const setup = await setupTypeTags(client, organisationKey, 1, {});

    expect(setup.tagIds.ops).toBeUndefined();
    expect(setup.tagIds.release).toBeUndefined();
    expect(setup.problems).toEqual([
      'The project has 2 tags labelled type:release, so FlagOps does not know which is its own. Remove the duplicates in Flagsmith.',
      'The tag type:ops has "permanent" set to false, but FlagOps needs true. Change it in Flagsmith, or rename it so FlagOps creates its own.',
    ]);
    expect(fake.writes().map((request) => (request.body as { label: string }).label)).toEqual([
      'type:experiment',
      'type:permission',
    ]);
  });

  it('keeps its recorded tags, whatever their label, and corrects is_permanent on them only', async () => {
    addTag(7, 'renamed by someone', false);
    addTag(8, 'type:ops', false);

    const setup = await setupTypeTags(client, organisationKey, 1, { ops: 7 });

    expect(setup.tagIds.ops).toBe(7);
    expect(setup.corrected).toEqual(['ops']);
    expect(fake.state.tags.find((tag) => tag.id === 7)?.is_permanent).toBe(true);
    expect(fake.state.tags.find((tag) => tag.id === 8)?.is_permanent).toBe(false);
  });

  it('writes nothing on a second run', async () => {
    const first = await setupTypeTags(client, organisationKey, 1, {});
    const writes = fake.writes().length;

    const second = await setupTypeTags(client, organisationKey, 1, first.tagIds);

    expect(second).toMatchObject({
      tagIds: first.tagIds,
      created: [],
      corrected: [],
      problems: [],
    });
    expect(fake.writes()).toHaveLength(writes);
  });
});

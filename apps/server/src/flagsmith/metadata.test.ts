import { FlagOpsError } from '@flagops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import type { FlagsmithClient } from './client.js';
import { flagopsFieldNames, setupMetadataFields } from './metadata.js';

const scope = { organisationId: 1, projectId: 1 };

let fake: FakeFlagsmith;
let client: FlagsmithClient;

beforeEach(() => {
  ({ fake, client } = fakeClient());
  const project = {
    id: 1,
    name: 'Shop',
    organisation: 1,
    hide_disabled_flags: false,
    stale_flags_limit_days: 30,
  };
  fake.state.projects.push(project);
  client.writeGuard.manage({ id: 1, name: 'FlagOps Demo' }, project, []);
});

function postsTo(path: string): number {
  return fake.writes().filter((request) => request.path === path).length;
}

describe('setupMetadataFields', () => {
  it('creates the four FlagOps fields in the project and binds each to features', async () => {
    const setup = await setupMetadataFields(client, organisationKey, scope);

    expect(setup.created).toEqual(flagopsFieldNames);
    expect(setup.bound).toEqual(flagopsFieldNames);
    expect(fake.state.fields.map((field) => [field.name, field.type, field.project])).toEqual([
      ['flagops_type', 'str', 1],
      ['flagops_expires_at', 'str', 1],
      ['flagops_exit_plan', 'multiline_str', 1],
      ['flagops_cleanup_prs', 'multiline_str', 1],
    ]);
    expect(Object.values(setup.fields).map((field) => field.bindingId)).toEqual(
      fake.state.bindings.map((binding) => binding.id),
    );
  });

  it('writes nothing when the fields and bindings exist', async () => {
    const first = await setupMetadataFields(client, organisationKey, scope);
    const writesBefore = fake.writes().length;

    const second = await setupMetadataFields(client, organisationKey, scope);

    expect(second).toEqual({ fields: first.fields, created: [], bound: [] });
    expect(fake.writes()).toHaveLength(writesBefore);
  });

  it('binds a field that a failed run created but never bound, without creating it again', async () => {
    await setupMetadataFields(client, organisationKey, scope);
    const expiresAt = fake.state.fields.find((field) => field.name === 'flagops_expires_at');
    fake.state.bindings = fake.state.bindings.filter((binding) => binding.field !== expiresAt?.id);
    const fieldPostsBefore = postsTo('/api/v1/metadata/fields/');

    const repaired = await setupMetadataFields(client, organisationKey, scope);

    expect(repaired.created).toEqual([]);
    expect(repaired.bound).toEqual(['flagops_expires_at']);
    expect(postsTo('/api/v1/metadata/fields/')).toBe(fieldPostsBefore);
    expect(fake.state.fields).toHaveLength(4);
    expect(fake.state.bindings.some((binding) => binding.field === expiresAt?.id)).toBe(true);
  });

  it('refuses a same-named field of another type instead of using it', async () => {
    fake.state.fields.push({
      id: 50,
      name: 'flagops_type',
      type: 'int',
      organisation: 1,
      project: 1,
    });

    const error: unknown = await setupMetadataFields(client, organisationKey, scope).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(FlagOpsError);
    expect((error as FlagOpsError).message).toContain('flagops_type has the type int');
    expect(fake.writes()).toEqual([]);
  });
});

import { FlagOpsError } from '@flagops/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { seeder } from '../../test/helpers/seeded-fake.js';
import { keyOrganisationResolver } from '../flagsmith/projects.js';
import { createLogger } from '../logger.js';
import { createInventoryStore } from './store.js';
import { createInventorySync } from './sync.js';
import type { Inventory } from './types.js';

const run = seeder();

beforeAll(async () => {
  await run.seed();
});

function syncWith(projectId?: number) {
  const store = createInventoryStore();
  const logs = captureLogs();
  const sync = createInventorySync({
    client: run.client,
    credential: organisationKey,
    keyOrganisation: keyOrganisationResolver(run.client, organisationKey),
    projectId,
    store,
    logger: createLogger('info', logs.destination),
    now: () => new Date('2026-11-27T12:00:00Z'),
  });
  return { sync, store, logs };
}

function flagOf(inventory: Inventory, name: string) {
  const flag = inventory.flags.find((item) => item.name === name);
  if (flag === undefined) {
    throw new Error(`no flag ${name}`);
  }
  return flag;
}

function environmentId(inventory: Inventory, name: string): number {
  return inventory.environments.find((item) => item.name === name)?.id ?? -1;
}

describe('inventory sync', () => {
  it('builds the inventory from the environment documents and the feature lists', async () => {
    const { sync, store } = syncWith();

    const inventory = await sync.run();

    expect(store.current()).toBe(inventory);
    expect(inventory.organisation.name).toBe('FlagOps Demo');
    expect(inventory.project).toMatchObject({ name: 'FlagOps Demo Shop', staleFlagsLimitDays: 30 });
    expect(
      inventory.environments.map((item) => [
        item.name,
        item.v2Versioning,
        item.changeRequestsBlockWrites,
        item.hideDisabledFlags,
      ]),
    ).toEqual([
      ['Development', true, false, false],
      ['Staging', true, false, false],
      ['Production', true, false, false],
    ]);
    expect(inventory.flags).toHaveLength(10);
    expect(inventory.segments.map((segment) => [segment.name, segment.managedBy])).toEqual([
      ['beta_testers', ''],
      ['staff', ''],
    ]);
  });

  it('holds each flag configuration in the normalised shape, with typed values', async () => {
    const inventory = await syncWith().sync.run();
    const production = environmentId(inventory, 'Production');
    const staging = environmentId(inventory, 'Staging');

    const darkMode = flagOf(inventory, 'dark_mode').environments[production];
    expect(darkMode?.config).toEqual({
      environmentDefault: { enabled: false, value: null, variants: [] },
      segmentOverrides: [
        {
          enabled: true,
          value: null,
          variants: [],
          segmentId: inventory.segments[0]?.id,
          priority: 0,
          segment: { kind: 'user' },
        },
      ],
      identityOverrides: [
        { identifier: 'user-0010', enabled: true, value: null },
        { identifier: 'user-0020', enabled: true, value: null },
        { identifier: 'user-0030', enabled: true, value: null },
      ],
    });
    expect(darkMode).toMatchObject({ segmentOverrideCount: 1, identityOverrideCount: 3 });
    expect(
      flagOf(inventory, 'free_shipping_threshold').environments[production]?.config
        ?.environmentDefault.value,
    ).toBe(50);
    expect(
      flagOf(inventory, 'recommendations_v2').environments[staging]?.config?.environmentDefault,
    ).toMatchObject({ enabled: true, value: 'control', variants: [{ weight: 50 }] });
  });

  it("reads FlagOps' metadata fields by name, and keeps the tags, archive flag and server-key-only flag", async () => {
    const inventory = await syncWith().sync.run();

    const newCheckout = flagOf(inventory, 'new_checkout');
    expect(newCheckout.metadata).toEqual({
      flagops_type: 'release',
      flagops_expires_at: '2026-11-21',
      flagops_exit_plan: expect.stringContaining('LegacyCheckout') as unknown,
      flagops_cleanup_prs: null,
    });
    expect(newCheckout).toMatchObject({ isArchived: false, isServerKeyOnly: false });
    expect(newCheckout.tagIds).toHaveLength(1);
    expect(flagOf(inventory, 'order_tracking_v2').metadata.flagops_type).toBeNull();
  });

  it('keeps the previous inventory when a sync fails, and records the failure once', async () => {
    const { sync, store, logs } = syncWith();
    const previous = await sync.run();
    run.fake.failNext(/\/document\/$/, 404, { detail: 'Not found.' });

    await expect(sync.run()).rejects.toBeInstanceOf(FlagOpsError);
    run.fake.failNext(/\/document\/$/, 404, { detail: 'Not found.' });
    await expect(sync.run()).rejects.toBeInstanceOf(FlagOpsError);

    expect(store.current()).toBe(previous);
    expect(store.lastFailure()).toMatchObject({ code: 'flagsmith_not_found' });
    expect(logs.entries().filter((entry) => entry.level === 40)).toHaveLength(1);

    await sync.run();
    expect(store.lastFailure()).toBeUndefined();
    expect(logs.entries()).toContainEqual(
      expect.objectContaining({ msg: 'Sync from Flagsmith recovered' }),
    );
  });

  it("hands the project it selected, with the project's environments, to the write guard", async () => {
    const { client } = fakeClient(run.fake);
    const sync = createInventorySync({
      client,
      credential: organisationKey,
      keyOrganisation: keyOrganisationResolver(client, organisationKey),
      projectId: undefined,
      store: createInventoryStore(),
      logger: createLogger('error', captureLogs().destination),
    });
    expect(() => {
      client.writeGuard.checkProject(1);
    }).toThrow(/has not selected/);

    const inventory = await sync.run();

    // Admitted targets pass silently; anything else is refused.
    client.writeGuard.checkProject(inventory.project.id);
    for (const environment of inventory.environments) {
      client.writeGuard.checkEnvironment(environment.apiKey);
    }
    expect(() => {
      client.writeGuard.checkProject(inventory.project.id + 1);
    }).toThrow(/refused a write to project/);
  });

  it('uses FLAGSMITH_PROJECT_ID when it is set, and names a project that does not exist', async () => {
    const projectId = run.fake.state.projects[0]?.id;

    await expect(syncWith(projectId).sync.run()).resolves.toMatchObject({
      project: { id: projectId },
    });
    await expect(syncWith(424_242).sync.run()).rejects.toThrow(
      'FLAGSMITH_PROJECT_ID is 424242, but the organisation FlagOps Demo has no project with that ID.',
    );
  });
});

describe('project selection without FLAGSMITH_PROJECT_ID', () => {
  it('says how to get a project when the organisation has none', async () => {
    const empty = seeder();
    const sync = createInventorySync({
      client: empty.client,
      credential: organisationKey,
      keyOrganisation: keyOrganisationResolver(empty.client, organisationKey),
      projectId: undefined,
      store: createInventoryStore(),
      logger: createLogger('error', captureLogs().destination),
    });

    await expect(sync.run()).rejects.toThrow(
      'No project in organisation FlagOps Demo. Run the seed or create a project in Flagsmith.',
    );
  });

  it('asks for FLAGSMITH_PROJECT_ID when the organisation has several projects', async () => {
    const two = seeder();
    for (const id of [1, 2]) {
      two.fake.state.projects.push({
        id,
        name: `Project ${id}`,
        organisation: 1,
        hide_disabled_flags: false,
        stale_flags_limit_days: 30,
      });
    }
    const sync = createInventorySync({
      client: two.client,
      credential: organisationKey,
      keyOrganisation: keyOrganisationResolver(two.client, organisationKey),
      projectId: undefined,
      store: createInventoryStore(),
      logger: createLogger('error', captureLogs().destination),
    });

    await expect(sync.run()).rejects.toThrow(/has 2 projects. Set FLAGSMITH_PROJECT_ID/);
  });
});

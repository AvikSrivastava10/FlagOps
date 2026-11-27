import { FlagOpsError } from '@flagops/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FakeFlagsmith } from '../../test/helpers/fake-flagsmith.js';
import { seeder } from '../../test/helpers/seeded-fake.js';
import { offsetDate } from './seed-runner.js';
import { seedFlags, seedIdentityCounts } from './seed-data.js';

function environment(fake: FakeFlagsmith, name: string) {
  const found = fake.state.environments.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`no environment ${name}`);
  }
  return found;
}

function feature(fake: FakeFlagsmith, name: string) {
  const found = fake.state.features.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`no feature ${name}`);
  }
  return found;
}

function flag(fake: FakeFlagsmith, environmentName: string, featureName: string) {
  return fake.state.flags.get(
    `${environment(fake, environmentName).api_key}:${feature(fake, featureName).id}`,
  );
}

function segmentId(fake: FakeFlagsmith, name: string): number | undefined {
  return fake.state.segments.find((segment) => segment.name === name)?.id;
}

function metadataOf(fake: FakeFlagsmith, featureName: string): Record<string, string> {
  const names = new Map(
    fake.state.bindings.map((binding) => [
      binding.id,
      fake.state.fields.find((field) => field.id === binding.field)?.name ?? '',
    ]),
  );
  return Object.fromEntries(
    feature(fake, featureName).metadata.map((item): [string, string] => [
      names.get(item.model_field) ?? `binding ${item.model_field}`,
      item.field_value,
    ]),
  );
}

function tagLabelsOf(fake: FakeFlagsmith, featureName: string): string[] {
  return feature(fake, featureName).tags.map(
    (id) => fake.state.tags.find((tag) => tag.id === id)?.label ?? '',
  );
}

describe('runSeed on an empty organisation', () => {
  const run = seeder();
  let first: Awaited<ReturnType<typeof run.seed>>;

  beforeAll(async () => {
    first = await run.seed();
  });

  it('creates the project and three environments, in order, with v2 versioning', () => {
    expect(run.fake.state.projects.map((project) => project.name)).toEqual(['FlagOps Demo Shop']);
    expect(
      run.fake.state.environments.map((item) => [item.name, item.use_v2_feature_versioning]),
    ).toEqual([
      ['Development', true],
      ['Staging', true],
      ['Production', true],
    ]);
    expect(first.changes.slice(0, 7)).toEqual([
      'Created the project FlagOps Demo Shop',
      'Created the environment Development',
      'Created the environment Staging',
      'Created the environment Production',
      'Enabled feature versioning v2 in Development',
      'Enabled feature versioning v2 in Staging',
      'Enabled feature versioning v2 in Production',
    ]);
  });

  it('creates the identities with their traits: 50, 200 and 1,000, with 142 beta testers in Production', () => {
    for (const [name, count] of Object.entries(seedIdentityCounts)) {
      const identities = run.fake.state.identities.filter(
        (identity) => identity.environment === environment(run.fake, name).api_key,
      );
      expect(identities).toHaveLength(count);
    }
    const production = run.fake.state.identities.filter(
      (identity) => identity.environment === environment(run.fake, 'Production').api_key,
    );
    expect(production.filter((identity) => identity.traits.get('beta') === true)).toHaveLength(142);
    expect(production.find((identity) => identity.identifier === 'user-0050')?.traits).toEqual(
      new Map<string, unknown>([
        ['beta', false],
        ['role', 'staff'],
        ['plan', 'free'],
      ]),
    );
  });

  it('sets every flag in every environment as architecture.md 13.1 lists, with DR-1', () => {
    const beta = segmentId(run.fake, 'beta_testers');
    const staff = segmentId(run.fake, 'staff');
    expect(flag(run.fake, 'Development', 'dark_mode')?.environment_default.enabled).toBe(true);
    expect(flag(run.fake, 'Production', 'dark_mode')).toEqual({
      environment_default: { enabled: false, value: null, variants: [] },
      segment_overrides: [
        { segment: { id: beta }, priority: 0, enabled: true, value: null, variants: [] },
      ],
    });
    expect(flag(run.fake, 'Development', 'admin_reports')?.segment_overrides).toEqual([]);
    for (const name of ['Staging', 'Production']) {
      expect(flag(run.fake, name, 'admin_reports')?.segment_overrides).toEqual([
        { segment: { id: staff }, priority: 0, enabled: true, value: null, variants: [] },
      ]);
    }
    expect(
      flag(run.fake, 'Production', 'free_shipping_threshold')?.environment_default.value,
    ).toEqual({
      type: 'integer',
      value: '50',
    });
  });

  it("weights recommendations_v2's one option 100, 50 and 0, on, on and off", () => {
    const option = feature(run.fake, 'recommendations_v2').multivariate_options[0]?.id;
    expect(
      ['Development', 'Staging', 'Production'].map((name) => {
        const state = flag(run.fake, name, 'recommendations_v2')?.environment_default;
        return [state?.enabled, state?.value, state?.variants];
      }),
    ).toEqual([
      [true, { type: 'string', value: 'control' }, [{ id: option, weight: 100 }]],
      [true, { type: 'string', value: 'control' }, [{ id: option, weight: 50 }]],
      [false, { type: 'string', value: 'control' }, [{ id: option, weight: 0 }]],
    ]);
  });

  it('turns dark_mode on for three identities in Production', () => {
    const darkMode = feature(run.fake, 'dark_mode').id;
    const identifiers = run.fake.state.identityOverrides
      .filter((override) => override.feature === darkMode && override.enabled)
      .map(
        (override) =>
          run.fake.state.identities.find((identity) => identity.id === override.identity)
            ?.identifier,
      );
    expect(identifiers).toEqual(['user-0010', 'user-0020', 'user-0030']);
  });

  it('writes each exit plan: metadata, one type tag and the FlagOps description line', () => {
    // The fake creates every feature on 2026-11-27, so new_checkout's deadline is 6 days earlier.
    expect(metadataOf(run.fake, 'new_checkout')).toEqual({
      flagops_type: 'release',
      flagops_expires_at: '2026-11-21',
      flagops_exit_plan:
        'Keep the new checkout as the only path, delete LegacyCheckout and legacyTotals, then archive the flag.',
    });
    expect(tagLabelsOf(run.fake, 'new_checkout')).toEqual(['type:release']);
    expect(feature(run.fake, 'new_checkout').description).toBe(
      'Single-page checkout that replaces the multi-step legacy checkout.\nFlagOps: release · remove by 2026-11-21',
    );
    expect(metadataOf(run.fake, 'payments_kill_switch')).toMatchObject({ flagops_type: 'ops' });
    expect(tagLabelsOf(run.fake, 'payments_kill_switch')).toEqual(['type:ops']);
    expect(feature(run.fake, 'payments_kill_switch').description).toContain(
      'FlagOps: ops · permanent',
    );
    expect(metadataOf(run.fake, 'order_tracking_v2')).toEqual({});
    expect(tagLabelsOf(run.fake, 'order_tracking_v2')).toEqual([]);
    expect(run.fake.state.tags.filter((tag) => tag.is_permanent).map((tag) => tag.label)).toEqual([
      'type:ops',
      'type:permission',
    ]);
  });

  it('creates exactly the ten flags of the demo data', () => {
    expect(run.fake.state.features.map((item) => item.name)).toEqual(
      seedFlags.map((item) => item.name),
    );
  });

  it('reports no changes and writes nothing on a second run', async () => {
    const writes = run.fake.writes().length;

    expect(await run.seed()).toEqual({ changes: [], warnings: [] });
    expect(run.fake.writes()).toHaveLength(writes);
  });

  it('restores what a demo take changed (DR-7): archive, PR links, description, states and traits', async () => {
    const newCheckout = feature(run.fake, 'new_checkout');
    const prBinding = run.fake.state.bindings.find(
      (binding) =>
        binding.field ===
        run.fake.state.fields.find((field) => field.name === 'flagops_cleanup_prs')?.id,
    );
    newCheckout.is_archived = true;
    newCheckout.metadata.push({
      model_field: prBinding?.id ?? 0,
      field_value: 'https://github.com/AvikSrivastava10/flagops-demo-shop/pull/1',
    });
    newCheckout.description = 'Edited during the demo.';
    const darkMode = flag(run.fake, 'Production', 'dark_mode');
    if (darkMode !== undefined) {
      darkMode.environment_default.enabled = true;
    }
    const user7 = run.fake.state.identities.find(
      (identity) =>
        identity.identifier === 'user-0007' &&
        identity.environment === environment(run.fake, 'Production').api_key,
    );
    user7?.traits.set('beta', false);
    user7?.traits.set('extra', 'added');
    const user10 = run.fake.state.identities.find(
      (identity) =>
        identity.identifier === 'user-0010' &&
        identity.environment === environment(run.fake, 'Production').api_key,
    );
    const override = run.fake.state.identityOverrides.find((item) => item.identity === user10?.id);
    if (override !== undefined) {
      override.enabled = false;
    }

    const report = await run.seed();

    expect(report.changes).toEqual([
      'Set dark_mode in Production',
      'Wrote the traits of 1 identities in Production, 0 of them new',
      'Turned dark_mode back on for user-0010 in Production',
      'Wrote the exit plan of new_checkout',
    ]);
    expect(override?.enabled).toBe(true);
    expect(newCheckout.is_archived).toBe(false);
    expect(metadataOf(run.fake, 'new_checkout').flagops_cleanup_prs).toBeUndefined();
    expect(newCheckout.description).toBe(
      'Single-page checkout that replaces the multi-step legacy checkout.\nFlagOps: release · remove by 2026-11-21',
    );
    expect(user7?.traits).toEqual(
      new Map<string, unknown>([
        ['beta', true],
        ['role', 'customer'],
        ['plan', 'free'],
      ]),
    );
    expect(await run.seed()).toEqual({ changes: [], warnings: [] });
  });

  it('warns about an identity override that is not part of the demo data, and leaves it alone', async () => {
    const giftWrap = feature(run.fake, 'gift_wrap').id;
    const production = environment(run.fake, 'Production').api_key;
    const identity = run.fake.state.identities.find(
      (item) => item.identifier === 'user-0001' && item.environment === production,
    );
    run.fake.state.identityOverrides.push({
      id: 99_999,
      environment: production,
      identity: identity?.id ?? 0,
      feature: giftWrap,
      enabled: true,
    });

    const report = await run.seed();

    expect(report.changes).toEqual([]);
    expect(report.warnings).toEqual([
      'gift_wrap has an identity override for user-0001 in Production, which is not part of the demo data and changes its impact preview. Remove it in Flagsmith.',
    ]);
    expect(run.fake.state.identityOverrides.some((override) => override.id === 99_999)).toBe(true);
  });
});

describe('runSeed safety', () => {
  it('refuses, writing nothing, when the organisation already holds another project', async () => {
    const run = seeder();
    run.fake.state.projects.push({
      id: 5,
      name: 'Payments',
      organisation: 1,
      hide_disabled_flags: false,
      stale_flags_limit_days: 30,
    });

    const error: unknown = await run.seed().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FlagOpsError);
    expect((error as FlagOpsError).message).toContain('already holds "Payments"');
    expect(run.fake.writes()).toEqual([]);
  });

  it('stops when a flag exists with a shape it cannot repair', async () => {
    const run = seeder();
    await run.seed();
    const recommendations = feature(run.fake, 'recommendations_v2');
    recommendations.type = 'STANDARD';
    recommendations.multivariate_options = [];

    await expect(run.seed()).rejects.toThrow(
      /recommendations_v2 exists with a shape the seed cannot repair/,
    );
  });
});

describe('offsetDate', () => {
  it('counts calendar days from the UTC date of a timestamp', () => {
    expect(offsetDate('2026-11-27T23:59:59.000000Z', -6)).toBe('2026-11-21');
    expect(offsetDate('2026-11-27T00:00:00+00:00', 50)).toBe('2027-01-16');
    expect(offsetDate('2026-03-01T12:00:00Z', -1)).toBe('2026-02-28');
  });
});

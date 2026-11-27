import type { FlagType } from '@flagops/shared';
import type { FlagApiValue } from '../flagsmith/flag-api.js';
import type { SegmentRule } from '../flagsmith/segments.js';
import type { TraitValue } from '../flagsmith/identities-api.js';

/** The demo data of architecture.md 13.1, with the demo-data decisions DR-1 and DR-7. */

export const seedProjectName = 'FlagOps Demo Shop';

export const seedEnvironmentNames = ['Development', 'Staging', 'Production'] as const;

export type SeedEnvironmentName = (typeof seedEnvironmentNames)[number];

export type SeedSegment = { name: string; description: string; rules: SegmentRule[] };

/** A segment that matches identities whose trait equals a value, as Flagsmith's dashboard writes it. */
function traitEquals(trait: string, value: string): SegmentRule[] {
  return [
    {
      type: 'ALL',
      rules: [
        {
          type: 'ANY',
          rules: [],
          conditions: [{ operator: 'EQUAL', property: trait, value }],
        },
      ],
      conditions: [],
    },
  ];
}

export const seedSegments: readonly SeedSegment[] = [
  {
    name: 'beta_testers',
    description: 'Customers in the beta programme',
    rules: traitEquals('beta', 'true'),
  },
  { name: 'staff', description: 'Shop staff', rules: traitEquals('role', 'staff') },
];

/** Identities per environment: user-0001 up to this number. */
export const seedIdentityCounts: Readonly<Record<SeedEnvironmentName, number>> = {
  Development: 50,
  Staging: 200,
  Production: 1000,
};

export function seedIdentifier(number: number): string {
  return `user-${String(number).padStart(4, '0')}`;
}

/** Every seventh identity is a beta tester (142 in Production), every fiftieth is staff. */
export function seedTraits(number: number): Record<string, TraitValue> {
  return {
    beta: number % 7 === 0,
    role: number % 50 === 0 ? 'staff' : 'customer',
    plan: number % 3 === 0 ? 'pro' : 'free',
  };
}

export type SeedEnvironmentState = {
  enabled: boolean;
  /** Segment overrides in priority order, starting at 0. */
  segmentOverrides?: readonly { segment: string; enabled: boolean }[];
  /** Weight of the flag's one multivariate option, when it has one. */
  variantWeight?: number;
  /** Identities with an override that turns the flag on. */
  identityOverrides?: readonly string[];
};

export type SeedFlag = {
  name: string;
  /** The description above the FlagOps line. */
  description: string;
  /** The value served in every environment; null for flags that carry none. */
  value: FlagApiValue;
  /** The one multivariate option, served with the weight each environment gives it. */
  variantOption?: string;
  environments: Readonly<Record<SeedEnvironmentName, SeedEnvironmentState>>;
  /** The deadline is the UTC date of the flag's `created_date` plus `deadlineOffsetDays`. */
  exitPlan: { type: FlagType; deadlineOffsetDays: number | null; steps: string } | null;
};

const off: SeedEnvironmentState = { enabled: false };
const on: SeedEnvironmentState = { enabled: true };

export const seedFlags: readonly SeedFlag[] = [
  {
    name: 'new_checkout',
    description: 'Single-page checkout that replaces the multi-step legacy checkout.',
    value: null,
    environments: { Development: on, Staging: on, Production: on },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: -6,
      steps:
        'Keep the new checkout as the only path, delete LegacyCheckout and legacyTotals, then archive the flag.',
    },
  },
  {
    name: 'dark_mode',
    description: 'Dark colour theme for the shop.',
    value: null,
    environments: {
      // DR-1: on for everyone in Development, as in Staging.
      Development: on,
      Staging: on,
      Production: {
        enabled: false,
        segmentOverrides: [{ segment: 'beta_testers', enabled: true }],
        identityOverrides: ['user-0010', 'user-0020', 'user-0030'],
      },
    },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: -25,
      steps: 'Roll dark mode out to everyone in Production, then remove the flag checks.',
    },
  },
  {
    name: 'holiday_banner',
    description: 'Seasonal banner on the home page.',
    value: null,
    environments: { Development: off, Staging: off, Production: off },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: -320,
      steps: 'The campaign is over: delete HolidayBanner and its check, then archive the flag.',
    },
  },
  {
    name: 'payments_kill_switch',
    description: 'Turns card payments off during a payment-provider incident.',
    value: null,
    environments: { Development: off, Staging: off, Production: off },
    exitPlan: {
      type: 'ops',
      deadlineOffsetDays: null,
      steps: 'Permanent: keep this switch for incidents.',
    },
  },
  {
    name: 'admin_reports',
    description: 'Sales reports in the admin area, for staff only.',
    value: null,
    environments: {
      // DR-1: no staff override in Development, so Production serves staff while Development
      // serves nobody (inverted drift).
      Development: off,
      Staging: { enabled: false, segmentOverrides: [{ segment: 'staff', enabled: true }] },
      Production: { enabled: false, segmentOverrides: [{ segment: 'staff', enabled: true }] },
    },
    exitPlan: {
      type: 'permission',
      deadlineOffsetDays: null,
      steps: 'Permanent: staff-only access to reports.',
    },
  },
  {
    name: 'recommendations_v2',
    description: 'Experiment: second-generation product recommendations.',
    value: { type: 'string', value: 'control' },
    variantOption: 'v2',
    environments: {
      Development: { enabled: true, variantWeight: 100 },
      Staging: { enabled: true, variantWeight: 50 },
      Production: { enabled: false, variantWeight: 0 },
    },
    exitPlan: {
      type: 'experiment',
      deadlineOffsetDays: 50,
      steps: 'Decide between control and v2, keep the winner, then remove the flag.',
    },
  },
  {
    name: 'legacy_search',
    description: 'Old search backend, kept for rollback.',
    value: null,
    environments: { Development: on, Staging: on, Production: on },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: -150,
      steps: 'No code reads this flag any more: archive it.',
    },
  },
  {
    name: 'free_shipping_threshold',
    description: 'Order total, in dollars, above which shipping is free.',
    value: { type: 'integer', value: '50' },
    environments: { Development: on, Staging: on, Production: on },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: 67,
      steps: 'Move the threshold into configuration, then remove the flag.',
    },
  },
  {
    name: 'gift_wrap',
    description: 'Gift wrapping at checkout. Not built yet.',
    value: null,
    environments: { Development: off, Staging: off, Production: off },
    exitPlan: {
      type: 'release',
      deadlineOffsetDays: 95,
      steps: 'Build gift wrapping behind the flag, release it, then remove the flag.',
    },
  },
  {
    name: 'order_tracking_v2',
    description: 'New order tracking page.',
    value: null,
    environments: { Development: on, Staging: off, Production: off },
    exitPlan: null,
  },
];

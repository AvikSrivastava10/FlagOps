import type { BoardStations } from '../../components/board-layout';
import type { FlagEntryData } from '../../components/FlagEntry';
import type { SidePanelItem } from '../../components/SidePanel';

/*
 * Gallery fixtures shaped like the seeded demo project (testing.md section 4), evaluated on
 * 2026-11-27. They exercise every station, every flag type and every notice glyph.
 */

type FlagFixture = Omit<FlagEntryData, 'id' | 'href' | 'history' | 'owners'> &
  Partial<Pick<FlagEntryData, 'history' | 'owners'>>;

function flag(fixture: FlagFixture): FlagEntryData {
  return {
    history: [{ stage: 'new', since: '2026-11-27' }],
    owners: ['@AvikSrivastava10'],
    ...fixture,
    id: fixture.name,
    href: `#flag-${fixture.name}`,
  };
}

const scan = {
  href: '#scan-demo-shop',
  source: 'Latest scan of AvikSrivastava10/flagops-demo-shop',
};
const environments = { href: '#platforms', source: 'Environment rows on the flag page' };

export const newCheckout = flag({
  name: 'new_checkout',
  type: 'release',
  health: [],
  zone: 'stale',
  evidence: [
    ['ON for everyone in ', { text: '3 of 3 environments', ...environments }, ' since today'],
    ['0 segment overrides'],
    [{ text: '2 references', ...scan }, ' in 1 repository'],
    ['exit plan deadline 2026-11-21 passed 6 days ago'],
  ],
  history: [
    { stage: 'new', since: '2026-11-20' },
    { stage: 'testing', since: '2026-11-21' },
    { stage: 'released', since: '2026-11-24' },
    { stage: 'stale', since: '2026-11-27' },
  ],
});

export const darkMode = flag({
  name: 'dark_mode',
  type: 'release',
  health: ['stuck_rollout'],
  zone: 'live',
  evidence: [
    [
      'Production: ON for segment beta_testers and ',
      { text: '3 identity overrides', ...environments },
    ],
    [{ text: '2 references', ...scan }],
  ],
  history: [
    { stage: 'new', since: '2026-10-02' },
    { stage: 'development', since: '2026-10-03' },
    { stage: 'testing', since: '2026-10-10' },
    { stage: 'rolling_out', since: '2026-10-20' },
  ],
});

export const boardStations: BoardStations = {
  new: [
    flag({
      name: 'gift_wrap',
      type: 'release',
      health: [],
      zone: 'new',
      evidence: [
        ['Not referenced in 1 tracked repository'],
        ['created 0 days ago'],
        ['OFF in 3 of 3'],
      ],
    }),
  ],
  development: [
    flag({
      name: 'order_tracking_v2',
      type: null,
      health: ['missing_exit_plan'],
      zone: 'live',
      owners: [],
      evidence: [
        [{ text: '2 references', ...scan }, ' in 1 repository'],
        ['served only in Development'],
      ],
    }),
  ],
  testing: [
    flag({
      name: 'recommendations_v2',
      type: 'experiment',
      health: [],
      zone: 'live',
      evidence: [
        ['Development: ON "v2" · Staging: PARTIAL · Production: OFF "control"'],
        [{ text: '2 references', ...scan }],
      ],
    }),
  ],
  rolling_out: [darkMode],
  released: [
    flag({
      name: 'free_shipping_threshold',
      type: 'release',
      health: [],
      zone: 'live',
      evidence: [
        ['ON for everyone in ', { text: '3 of 3 environments', ...environments }, ' since today'],
        ['0 segment overrides'],
        [{ text: '2 references', ...scan }, ' in 1 repository'],
      ],
    }),
  ],
  permanent: [
    flag({
      name: 'payments_kill_switch',
      type: 'ops',
      health: [],
      zone: 'permanent',
      evidence: [['Type: ops'], ['tagged permanent in Flagsmith']],
    }),
    flag({
      name: 'admin_reports',
      type: 'permission',
      health: ['inverted_drift'],
      zone: 'permanent',
      evidence: [['Production: ON for segment staff; Development: OFF for everyone']],
    }),
  ],
  abandoned: [
    flag({
      name: 'holiday_banner',
      type: 'release',
      health: [],
      zone: 'stale',
      evidence: [
        ['OFF in all 3 environments'],
        ['exit plan deadline 2026-01-11 passed 320 days ago'],
      ],
    }),
  ],
  stale: [newCheckout],
  cleanup: [],
  to_remove: [
    flag({
      name: 'legacy_search',
      type: 'release',
      health: ['ghost'],
      zone: 'to_remove',
      evidence: [
        ['0 references in 1 repository (last scan 09:14)'],
        ['exit plan deadline 2026-06-30 passed 150 days ago'],
      ],
    }),
  ],
  archived: [
    flag({
      name: 'checkout_banner_q3_experiment_with_a_very_long_name',
      type: 'experiment',
      health: [],
      zone: null,
      evidence: [['Archived in Flagsmith on 2026-11-02 by FlagOps']],
    }),
  ],
};

/** A station with more flags than fit, so its list scrolls under the plate. */
export const crowdedStation: readonly FlagEntryData[] = Array.from({ length: 18 }, (_, index) =>
  flag({
    name: `search_ranking_variant_${String(index + 1).padStart(2, '0')}`,
    type: index % 3 === 0 ? 'experiment' : 'release',
    health: index % 5 === 0 ? ['stuck_rollout'] : [],
    zone: 'live',
    evidence: [['Production: PARTIAL for segment ranking_beta'], ['1 reference']],
  }),
);

export const unknownNames: readonly SidePanelItem[] = [
  {
    id: 'recomendations_v2',
    name: 'recomendations_v2',
    detail: 'web/src/App.tsx:14 · Zombie reference · did you mean recommendations_v2?',
  },
];

export const notPlaced: readonly SidePanelItem[] = [
  {
    id: 'beta_checkout_copy',
    name: 'beta_checkout_copy',
    detail: 'No feature state in Staging',
    href: '#flag-beta_checkout_copy',
  },
];

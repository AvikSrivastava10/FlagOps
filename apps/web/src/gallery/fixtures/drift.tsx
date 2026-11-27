import type { TimetableEnvironment, TimetableRow } from '../../components/timetable-data';

export const driftEnvironments: readonly TimetableEnvironment[] = [
  { id: 'development', name: 'Development' },
  { id: 'staging', name: 'Staging' },
  { id: 'production', name: 'Production' },
];

const promote = (flag: string, from: string, to: string) => `#promote-${flag}-${from}-${to}`;

function detail(lines: readonly string[]) {
  return (
    <ul>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** One row per drift category, from the seeded demo project (testing.md section 4). */
export const driftRows: readonly TimetableRow[] = [
  {
    id: 'admin_reports',
    flag: { name: 'admin_reports', type: 'permission', href: '#flag-admin_reports' },
    cells: [
      { state: 'off', value: null, href: '#env-development' },
      { state: 'partial', value: null, href: '#env-staging' },
      { state: 'partial', value: null, href: '#env-production' },
    ],
    drift: [
      {
        category: 'later_serves_more',
        href: promote('admin_reports', 'development', 'staging'),
      },
      { category: 'aligned', href: promote('admin_reports', 'staging', 'production') },
    ],
    detail: detail([
      'Segment staff: overridden in Staging and Production, not in Development (one-sided)',
      'serves more later since 2026-11-26 09:14',
    ]),
  },
  {
    id: 'dark_mode',
    flag: { name: 'dark_mode', type: 'release', href: '#flag-dark_mode' },
    cells: [
      { state: 'on', value: 'true', href: '#env-development' },
      { state: 'on', value: 'true', href: '#env-staging' },
      { state: 'partial', value: null, href: '#env-production' },
    ],
    drift: [
      { category: 'aligned', href: promote('dark_mode', 'development', 'staging') },
      { category: 'ahead', href: promote('dark_mode', 'staging', 'production') },
    ],
    detail: detail([
      'Segment beta_testers: only in Production',
      '3 identity overrides in Production, not compared',
      'ahead in earlier environment since 2026-11-20 08:02',
    ]),
  },
  {
    id: 'free_shipping_threshold',
    flag: {
      name: 'free_shipping_threshold',
      type: 'release',
      href: '#flag-free_shipping_threshold',
    },
    cells: [
      { state: 'on', value: '50', href: '#env-development' },
      { state: 'on', value: '75', href: '#env-staging' },
      { state: 'on', value: '75', href: '#env-production' },
    ],
    drift: [
      {
        category: 'value_drift',
        href: promote('free_shipping_threshold', 'development', 'staging'),
      },
      { category: 'aligned', href: promote('free_shipping_threshold', 'staging', 'production') },
    ],
    detail: detail(['Value: 50 in Development, 75 in Staging', '≠ value since 2026-11-25 17:40']),
  },
  {
    id: 'recommendations_v2',
    flag: { name: 'recommendations_v2', type: 'experiment', href: '#flag-recommendations_v2' },
    cells: [
      { state: 'on', value: '"v2"', href: '#env-development' },
      { state: 'partial', value: null, href: '#env-staging' },
      { state: 'off', value: '"control"', href: '#env-production' },
    ],
    drift: [
      { category: 'ahead', href: promote('recommendations_v2', 'development', 'staging') },
      { category: 'override_drift', href: promote('recommendations_v2', 'staging', 'production') },
    ],
    detail: detail(['Segment beta_testers: priority 0 in Staging, 1 in Production']),
  },
  {
    id: 'order_tracking_v2',
    flag: { name: 'order_tracking_v2', type: null, href: '#flag-order_tracking_v2' },
    cells: [
      { state: 'on', value: 'true', href: '#env-development' },
      { state: 'off', value: 'true', href: '#env-staging' },
      { state: 'off', value: 'true', href: '#env-production' },
    ],
    drift: [
      {
        category: 'one_sided_override',
        href: promote('order_tracking_v2', 'development', 'staging'),
      },
      { category: 'dependency_drift', href: promote('order_tracking_v2', 'staging', 'production') },
    ],
    detail: detail(['Production depends on new_checkout; Staging has no dependency']),
  },
];

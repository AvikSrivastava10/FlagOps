/** How one flag differs between two adjacent environments (architecture.md 5.5). */
export const driftCategories = [
  'aligned',
  'later_serves_more',
  'ahead',
  'value_drift',
  'override_drift',
  'one_sided_override',
  'dependency_drift',
] as const;

export type DriftCategory = (typeof driftCategories)[number];

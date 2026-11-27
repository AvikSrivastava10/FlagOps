/** Health conditions FlagOps raises on a flag (architecture.md 5.4). */
export const healthIds = [
  'stuck_rollout',
  'inverted_drift',
  'zombie_reference',
  'ghost',
  'reused_name',
  'missing_exit_plan',
] as const;

export type HealthId = (typeof healthIds)[number];

export const healthLabels: Readonly<Record<HealthId, string>> = {
  stuck_rollout: 'Stuck rollout',
  inverted_drift: 'Inverted drift',
  zombie_reference: 'Zombie reference',
  ghost: 'Ghost',
  reused_name: 'Reused name',
  missing_exit_plan: 'Missing exit plan',
};

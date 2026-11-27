/**
 * Lifecycle stages FlagOps derives for a flag (architecture.md 5.3), in the order of the line:
 * the main line from New to Archived, then the Abandoned and Permanent side paths, then `unknown`
 * for flags whose stage cannot be computed.
 */
export const stageIds = [
  'new',
  'development',
  'testing',
  'rolling_out',
  'released',
  'stale',
  'cleanup',
  'to_remove',
  'archived',
  'abandoned',
  'permanent',
  'unknown',
] as const;

export type StageId = (typeof stageIds)[number];

export const stageLabels: Readonly<Record<StageId, string>> = {
  new: 'New',
  development: 'In development',
  testing: 'Testing',
  rolling_out: 'Rolling out',
  released: 'Released',
  stale: 'Ready for removal',
  cleanup: 'Cleanup PR open',
  to_remove: 'To remove',
  archived: 'Archived',
  abandoned: 'Abandoned',
  permanent: 'Permanent',
  unknown: 'Unknown',
};

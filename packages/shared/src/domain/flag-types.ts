/** Flag types of an exit plan, after Pete Hodgson's taxonomy (architecture.md 5.7). */
export const flagTypes = ['release', 'experiment', 'ops', 'permission'] as const;

export type FlagType = (typeof flagTypes)[number];

/** Types that never expire. Their `type:` tags carry `is_permanent: true` in Flagsmith. */
export const permanentFlagTypes: readonly FlagType[] = ['ops', 'permission'];

/** Kinds of record a repository scan produces (architecture.md 8.3 and 16, table `code_refs`). */
export const recordKinds = [
  'reference',
  'test_reference',
  'unresolved_name',
  'ambiguous_name',
  'dynamic',
  'unattributed',
  'mention',
  'test_mention',
] as const;

export type RecordKind = (typeof recordKinds)[number];

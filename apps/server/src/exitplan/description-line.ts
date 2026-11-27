import type { FlagType } from '@flagops/shared';

/**
 * The FlagOps line in a flag's Flagsmith description (architecture.md 5.7): a visible mirror of
 * the exit plan, because the open-source dashboard does not show metadata fields (D-010).
 * For example `FlagOps: release · remove by 2026-11-21 · https://github.com/o/r/pull/7`.
 */
const descriptionLinePrefix = 'FlagOps: ';

export type DescriptionLinePlan = {
  type: FlagType;
  /** The removal deadline, `YYYY-MM-DD`; null for ops and permission flags, which are permanent. */
  expiresAt: string | null;
  cleanupPrs: readonly string[];
};

export function formatDescriptionLine(plan: DescriptionLinePlan): string {
  const deadline = plan.expiresAt === null ? 'permanent' : `remove by ${plan.expiresAt}`;
  return descriptionLinePrefix + [plan.type, deadline, ...plan.cleanupPrs].join(' · ');
}

function lastLineIndex(lines: readonly string[]): number {
  return lines.findLastIndex((line) => line.startsWith(descriptionLinePrefix));
}

/** The last line of the description that starts with `FlagOps: `, or null. */
export function findDescriptionLine(description: string): string | null {
  const lines = description.split('\n');
  return lines[lastLineIndex(lines)] ?? null;
}

/**
 * The description with its FlagOps line replaced by `line`, or added at the end. The other text
 * keeps every byte, except the whitespace at its ends: Flagsmith trims descriptions anyway
 * (architecture.md 6.5), so the result is what Flagsmith stores.
 */
export function withDescriptionLine(description: string, line: string): string {
  const lines = description.split('\n');
  const index = lastLineIndex(lines);
  const rest = (index === -1 ? lines : lines.toSpliced(index, 1)).join('\n').trim();
  return rest === '' ? line : `${rest}\n${line}`;
}

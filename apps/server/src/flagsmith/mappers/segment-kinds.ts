import type { SegmentKind } from '@flagops/shared';
import type { DocumentRule } from '../document.js';

/** What the segments list says about a listed segment. */
export type ListedSegment = { id: number; managed_by: string | null };

const prerequisitePattern = /^\$\.flags\[(".*")\]\.enabled$/;

/**
 * The prerequisite of a flag-dependency segment, or null. Flagsmith writes such a segment with
 * exactly one ANY rule holding one condition, `$.flags["<name>"].enabled NOT_EQUAL "true"`
 * (`api/features/dependencies/services.py:676-706`), where the name is a JSON string.
 */
export function dependencyPrerequisite(rules: readonly DocumentRule[]): string | null {
  const [rule] = rules;
  const condition = rule?.conditions[0];
  if (
    rules.length !== 1 ||
    rule === undefined ||
    rule.type !== 'ANY' ||
    rule.rules.length > 0 ||
    rule.conditions.length !== 1 ||
    condition === undefined ||
    condition.operator !== 'NOT_EQUAL' ||
    condition.value !== 'true'
  ) {
    return null;
  }
  const match = prerequisitePattern.exec(condition.property_ ?? '');
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    const name: unknown = JSON.parse(match[1]);
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/**
 * Classifies the segment an override targets (architecture.md 5.1). The segments list never
 * returns system segments, so a segment missing from it is a system segment: a flag dependency
 * when its rules have the dependency shape, any other system segment otherwise.
 */
export function segmentKind(
  segmentId: number,
  listed: ReadonlyMap<number, ListedSegment>,
  documentRules: readonly DocumentRule[] | undefined,
): SegmentKind {
  const segment = listed.get(segmentId);
  if (segment !== undefined) {
    return segment.managed_by === null || segment.managed_by === ''
      ? { kind: 'user' }
      : { kind: 'managed', managedBy: segment.managed_by };
  }
  const prerequisite = documentRules === undefined ? null : dependencyPrerequisite(documentRules);
  return prerequisite === null ? { kind: 'system' } : { kind: 'dependency', prerequisite };
}

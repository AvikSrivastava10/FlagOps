/**
 * Joins the class names that are set. CSS Module lookups are `string | undefined` under
 * `noUncheckedIndexedAccess`, and conditional classes are `false` when they do not apply.
 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

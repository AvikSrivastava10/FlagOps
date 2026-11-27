import { normaliseClientName, type Product } from './sdk-modules.js';

/**
 * Name resolution (architecture.md 8.3, D-043): which Flagsmith flag a static name reads, under
 * the rule of the SDK that reads it. The Node SDK looks flags up exactly; the client and React
 * SDKs normalise the name, so two Flagsmith names that normalise alike are ambiguous there.
 */
export type NameResolution =
  | { kind: 'flag'; flag: string }
  | { kind: 'ambiguous'; flags: string[] }
  | { kind: 'unresolved'; suggestion: string | null };

export type NameResolver = (product: Product, literal: string) => NameResolution;

/**
 * Damerau-Levenshtein distance in its optimal-string-alignment form: inserting, deleting or
 * substituting a character, or swapping two adjacent ones, each count as one edit.
 */
function distance(a: string, b: string): number {
  const width = b.length + 1;
  const cells = new Array<number>((a.length + 1) * width).fill(0);
  const cell = (i: number, j: number): number => cells[i * width + j] ?? 0;
  for (let i = 0; i <= a.length; i += 1) {
    for (let j = 0; j <= b.length; j += 1) {
      if (i === 0 || j === 0) {
        cells[i * width + j] = i + j;
        continue;
      }
      const substitution = cell(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const swap =
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? cell(i - 2, j - 2) + 1
          : Infinity;
      cells[i * width + j] = Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, substitution, swap);
    }
  }
  return cell(a.length, b.length);
}

/** A Zombie's suggestion is at most this many edits away (architecture.md 5.4). */
const maxSuggestionDistance = 2;

/**
 * The flag with the smallest case-insensitive distance to an unknown name, if that distance is at
 * most 2. `flags` is sorted, so a tie goes to the alphabetically first name.
 */
function nearest(literal: string, flags: readonly string[]): string | null {
  const wanted = literal.toLowerCase();
  let best: { flag: string; score: number } | undefined;
  for (const flag of flags) {
    const score = distance(wanted, flag.toLowerCase());
    if (score <= maxSuggestionDistance && (best === undefined || score < best.score)) {
      best = { flag, score };
    }
  }
  return best?.flag ?? null;
}

export function createNameResolver(flagNames: readonly string[]): NameResolver {
  const flags = [...new Set(flagNames)].sort();
  const exact = new Set(flags);
  const byNormalised = new Map<string, string[]>();
  for (const flag of flags) {
    const key = normaliseClientName(flag);
    byNormalised.set(key, [...(byNormalised.get(key) ?? []), flag]);
  }
  return (product, literal) => {
    if (product === 'node') {
      return exact.has(literal)
        ? { kind: 'flag', flag: literal }
        : { kind: 'unresolved', suggestion: nearest(literal, flags) };
    }
    const matches = byNormalised.get(normaliseClientName(literal)) ?? [];
    const [only] = matches;
    if (only === undefined) {
      return { kind: 'unresolved', suggestion: nearest(literal, flags) };
    }
    return matches.length === 1
      ? { kind: 'flag', flag: only }
      : { kind: 'ambiguous', flags: matches };
  };
}

/**
 * The flags a mention names (architecture.md 8.3): exact names, plus normalised client names
 * where the package uses the client SDK.
 */
export function mentionedFlags(
  literal: string,
  flagNames: readonly string[],
  clientPackage: boolean,
): string[] {
  const wanted = normaliseClientName(literal);
  return flagNames.filter(
    (flag) => flag === literal || (clientPackage && normaliseClientName(flag) === wanted),
  );
}

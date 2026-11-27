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

/** Edit distance between two strings, for the nearest-name suggestion of a Zombie reference. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The closest flag name, when it is close enough to be a likely typo: at most a third of the
 * name's length away, and at most 3 edits. Ties go to the alphabetically first name.
 */
function nearest(literal: string, flags: readonly string[]): string | null {
  const wanted = normaliseClientName(literal);
  const limit = Math.min(3, Math.floor(wanted.length / 3));
  let best: { flag: string; score: number } | undefined;
  for (const flag of flags) {
    const score = distance(wanted, normaliseClientName(flag));
    if (score <= limit && (best === undefined || score < best.score)) {
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

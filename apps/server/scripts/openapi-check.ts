/**
 * `pnpm openapi:check`: compares the live Flagsmith OpenAPI schema with the pinned copy, for the
 * paths FlagOps calls (architecture.md 6.1, D-006). File hashes cannot do this, because two
 * fetches of the same release differ in a component's name. So the check inlines every `$ref`,
 * drops descriptions and titles, and compares the operations of each path structurally.
 *
 * The paths are the quoted `/api/...` strings in the Flagsmith adapter, so the list follows the
 * code. Exits 1 when a path FlagOps calls is missing from the live schema or differs from the
 * pinned one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { paths: Record<string, Json>; components?: Record<string, Record<string, Json>> };

const adapterDirectory = fileURLToPath(new URL('../src/flagsmith/', import.meta.url));
const pinnedFile = new URL('../src/flagsmith/openapi/flagsmith-2.295.2.json', import.meta.url);

function adapterSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'openapi' ? [] : adapterSources(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** The quoted API paths in the adapter's code. */
function usedPaths(): string[] {
  const found = new Set<string>();
  for (const file of adapterSources(adapterDirectory)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/'(\/api\/[^'\s]*)'/g)) {
      if (match[1] !== undefined) {
        found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

const ignoredKeys = new Set(['description', 'title', 'example', 'examples']);

/** The value with every `$ref` inlined, without descriptions, keys sorted; cycles become a marker. */
function resolve(value: Json, schema: Schema, seen: readonly string[] = []): Json {
  if (Array.isArray(value)) {
    return value.map((item) => resolve(item, schema, seen));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const ref = value.$ref;
  if (typeof ref === 'string') {
    const [, , group, name] = ref.split('/');
    const target =
      group === undefined || name === undefined ? undefined : schema.components?.[group]?.[name];
    if (target === undefined) {
      return { unresolved: ref };
    }
    return seen.includes(ref) ? { recursive: true } : resolve(target, schema, [...seen, ref]);
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !ignoredKeys.has(key))
      .sort()
      .map((key) => [key, resolve(value[key] ?? null, schema, seen)]),
  );
}

/** The JSON pointer of the first difference between two resolved values, or undefined. */
function firstDifference(a: Json, b: Json, pointer = ''): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    return undefined;
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const left = (a as Record<string, Json>)[key] ?? null;
      const right = (b as Record<string, Json>)[key] ?? null;
      const difference = firstDifference(left, right, `${pointer}/${key}`);
      if (difference !== undefined) {
        return difference;
      }
    }
  }
  return pointer === '' ? '/' : pointer;
}

async function main(): Promise<number> {
  const base = (process.env.FLAGSMITH_INTERNAL_URL ?? process.env.FLAGSMITH_URL ?? '').trim();
  if (base === '') {
    console.error('FLAGSMITH_URL is required (URL of your Flagsmith API)');
    return 1;
  }
  const response = await fetch(`${base.replace(/\/+$/, '')}/api/v1/swagger.json`);
  if (!response.ok) {
    console.error(`Flagsmith answered ${response.status} for /api/v1/swagger.json`);
    return 1;
  }
  const live = (await response.json()) as Schema;
  const pinned = JSON.parse(readFileSync(pinnedFile, 'utf8')) as Schema;
  const version = response.headers.get('flagsmith-version') ?? 'unknown';

  const problems: string[] = [];
  const paths = usedPaths();
  for (const apiPath of paths) {
    const pinnedItem = pinned.paths[apiPath];
    const liveItem = live.paths[apiPath];
    if (pinnedItem === undefined) {
      problems.push(`${apiPath}: FlagOps calls it, but the pinned schema does not have it`);
    } else if (liveItem === undefined) {
      problems.push(`${apiPath}: missing from the live schema`);
    } else {
      const difference = firstDifference(resolve(pinnedItem, pinned), resolve(liveItem, live));
      if (difference !== undefined) {
        problems.push(`${apiPath}: differs from the pinned schema at ${difference}`);
      }
    }
  }

  const pinnedPaths = new Set(Object.keys(pinned.paths));
  const livePaths = new Set(Object.keys(live.paths));
  const added = [...livePaths].filter((item) => !pinnedPaths.has(item));
  const removed = [...pinnedPaths].filter((item) => !livePaths.has(item));
  console.log(
    `Flagsmith ${version}: ${livePaths.size} paths live, ${pinnedPaths.size} pinned; ${added.length} added, ${removed.length} removed.`,
  );
  if (problems.length > 0) {
    console.error(`${problems.length} of the ${paths.length} paths FlagOps calls do not match:`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    return 1;
  }
  console.log(`All ${paths.length} paths FlagOps calls match the pinned schema.`);
  return 0;
}

process.exitCode = await main();

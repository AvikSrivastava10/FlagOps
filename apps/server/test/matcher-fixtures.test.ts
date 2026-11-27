import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchRepository, type RepositoryFile } from '../src/matcher/match-repository.js';
import type { CodeRecord } from '../src/matcher/records.js';

/**
 * The matcher fixtures (plan S4): each folder under fixtures/matcher holds `input/`, a repository,
 * and `case.json` with the Flagsmith flag names and the expected records. Fixture files named
 * `*.__test__.*` stand for `*.test.*` files, so no tool mistakes them for tests of FlagOps.
 */
type ExpectedRecord = {
  kind: string;
  flag: string | null;
  file: string;
  line: number;
  rule: string;
  traced?: boolean;
  suggestion?: string;
};

type Case = {
  description: string;
  flags: string[];
  accessorRules?: string[];
  accessorProblems?: { entry: string; reason: string }[];
  expect: { records: ExpectedRecord[] };
};

const root = fileURLToPath(new URL('./fixtures/matcher/', import.meta.url));

function readTree(directory: string, prefix = ''): RepositoryFile[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const full = path.join(directory, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) {
        return readTree(full, relative);
      }
      return [{ path: relative.replace('.__test__.', '.test.'), text: readFileSync(full, 'utf8') }];
    });
}

/** Reads and mentions are traced the other way round by default, so only the exception shows. */
function project(record: CodeRecord): ExpectedRecord {
  const usuallyTraced = !['mention', 'test_mention', 'unattributed'].includes(record.kind);
  return {
    kind: record.kind,
    flag: record.flagName ?? record.literal,
    file: record.filePath,
    line: record.line,
    rule: record.ruleId,
    ...(record.traced === usuallyTraced ? {} : { traced: record.traced }),
    ...(record.suggestion === null ? {} : { suggestion: record.suggestion }),
  };
}

const cases = readdirSync(root).filter((name) => statSync(path.join(root, name)).isDirectory());

describe('matcher fixtures', () => {
  it('finds the fixture folders', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases)('%s', (name) => {
    const fixture = JSON.parse(readFileSync(path.join(root, name, 'case.json'), 'utf8')) as Case;
    const files = readTree(path.join(root, name, 'input'));

    const result = matchRepository(files, fixture.flags);

    expect(result.parseErrors).toEqual([]);
    expect(result.records.map(project)).toEqual(fixture.expect.records);
    expect(result.accessorProblems).toEqual(fixture.accessorProblems ?? []);
    if (fixture.accessorRules !== undefined) {
      expect(result.accessorRules).toEqual(fixture.accessorRules);
    }
    // Determinism: a second run over the same input gives the same output.
    expect(JSON.stringify(matchRepository(files, fixture.flags))).toBe(JSON.stringify(result));
  });
});

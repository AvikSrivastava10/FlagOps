// @vitest-environment node
// This test reads the source files from disk. Under Vitest a stylesheet import returns a class-name
// proxy, never its text, so the files are read with node:fs, in the node environment.
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ui-design.md 3: components use tokens only. No hex, rgb() or hsl() colour literal may appear in
// apps/web/src/**/*.{css,tsx} outside design/tokens.css (plan.md, P2 exit criterion 6).
const source = fileURLToPath(new URL('..', import.meta.url));
const tokensFile = join('design', 'tokens.css');
const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(css|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function literalsIn(path: string): string[] {
  const name = relative(source, path).split(sep).join('/');
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      (line.match(literal) ?? []).map((match) => `${name}:${index + 1} ${match}`),
    );
}

describe('colour literals', () => {
  it('appear only in design/tokens.css', () => {
    const scanned = files(source).filter((path) => relative(source, path) !== tokensFile);
    expect(scanned.length).toBeGreaterThan(30);
    expect(scanned.flatMap(literalsIn)).toEqual([]);
  });

  it('are found by the check where they belong', () => {
    expect(literalsIn(join(source, tokensFile)).length).toBeGreaterThan(30);
  });
});

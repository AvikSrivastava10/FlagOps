import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The file rules of structure.md section 2, checked on every string in `apps/server/src`, so
 * comments never count and dynamic forms (`import()`, `require`, template literals) do:
 * - only `flagsmith/features.ts` addresses a feature for update, because Flagsmith deletes the
 *   metadata an update leaves out (architecture.md 6.5);
 * - only `flagsmith/flag-api.ts` calls the experimental `/api/__future__/` routes;
 * - only `impact/engine/` names an `@flagsmith/` module, because ESLint's
 *   `no-restricted-imports` sees static imports only (S2 review #1). The matcher's
 *   `sdk-modules.ts` names the packages too, as data it matches import specifiers against, and
 *   loads no module at all.
 * Tests under `apps/server/test/` are outside the rule: a live test sends a raw PATCH on purpose.
 */
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Every string literal and template text in the code, with template substitutions as `${}`. */
function stringsIn(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const strings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      strings.push(
        node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join(''),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings;
}

const files = sourceFiles(sourceRoot).map((file) => ({
  name: path.relative(sourceRoot, file).split(path.sep).join('/'),
  strings: stringsIn(file, readFileSync(file, 'utf8')),
}));

function offenders(test: (value: string) => boolean, allowed: (name: string) => boolean): string[] {
  return files
    .filter((file) => !allowed(file.name) && file.strings.some(test))
    .map((file) => file.name);
}

/** A feature's detail endpoint, in OpenAPI form or as a template: what an update is sent to. */
const featureDetail = /\/projects\/(\{project_pk\}|\$\{\})\/features\/(\{id\}|\$\{\})\/?$/;
const futureApi = (value: string) => value.includes('/api/__future__/');
const flagsmithModule = (value: string) => value.startsWith('@flagsmith/');
/** The matcher's SDK knowledge names the packages as data (codemod REPORT 7.1, rule 2). */
const sdkData = 'matcher/sdk-modules.ts';

describe('source rules of structure.md section 2', () => {
  it('finds the server sources', () => {
    expect(files.map((file) => file.name)).toContain('flagsmith/features.ts');
  });

  it('lets only flagsmith/features.ts address a feature for update', () => {
    expect(
      offenders(
        (value) => featureDetail.test(value),
        (name) => name === 'flagsmith/features.ts',
      ),
    ).toEqual([]);
  });

  it('lets only flagsmith/flag-api.ts call /api/__future__/', () => {
    expect(offenders(futureApi, (name) => name === 'flagsmith/flag-api.ts')).toEqual([]);
  });

  it('lets only impact/engine/ name an @flagsmith/ module, statically or dynamically', () => {
    expect(
      offenders(flagsmithModule, (name) => name.startsWith('impact/engine/') || name === sdkData),
    ).toEqual([]);
  });

  it('keeps the matcher SDK package names as data: matcher/sdk-modules.ts loads no module', () => {
    const code = readFileSync(path.join(sourceRoot, sdkData), 'utf8');
    const source = ts.createSourceFile(sdkData, code, ts.ScriptTarget.Latest, true);
    const loads: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
        loads.push(node.getText(source));
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isLoader =
          callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && ['require', 'createRequire'].includes(callee.text));
        if (isLoader) {
          loads.push(node.getText(source));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(loads).toEqual([]);
  });

  it('catches dynamic imports, require calls and template literals, and ignores comments', () => {
    const strings = stringsIn(
      'probe.ts',
      [
        "const sdk = await import('@flagsmith/nodejs');",
        "const same = createRequire(import.meta.url)('@flagsmith/nodejs');",
        "fetch(`/api/v1/projects/${p}/features/${id}/`, { method: 'PATCH' });",
        'fetch(`/api/__future__/environments/${key}/features/${id}/`);',
        "// '@flagsmith/nodejs' and '/api/__future__/' in a comment do not count",
      ].join('\n'),
    );

    expect(strings.filter(flagsmithModule)).toHaveLength(2);
    expect(strings.filter((value) => featureDetail.test(value))).toHaveLength(1);
    expect(strings.filter(futureApi)).toHaveLength(1);
  });
});

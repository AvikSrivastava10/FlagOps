import { posix } from 'node:path';
import type * as t from '@babel/types';
import ignore from 'ignore';
import {
  accessorConfigPath,
  parseAccessorConfig,
  type AccessorProblem,
} from './accessor-config.js';
import { accessorCallOf, type ValidAccessor } from './accessor-calls.js';
import { validateAccessors } from './accessor-validation.js';
import { matchFile } from './match-file.js';
import { findMentions } from './mentions.js';
import { createModuleResolver } from './module-resolver.js';
import { createPackageContext } from './package-context.js';
import { parseSource } from './parse.js';
import { isCodeFile, isTestLike } from './paths.js';
import { compareRecords, sourceLines, type CodeRecord, type SourceLines } from './records.js';
import { buildRepositoryIndex, type ParsedModule } from './repo-pass.js';
import { Classifier } from './receivers.js';
import { createNameResolver } from './resolve-name.js';
import type { ReadContext } from './sdk-reads.js';

/**
 * The matcher's entry point (architecture.md 8.3): a pure function from a repository's files and
 * Flagsmith's flag names to records. The scanner does the I/O; the codemod reuses the modules.
 */
export type RepositoryFile = { path: string; text: string };

export type MatchResult = {
  records: CodeRecord[];
  /** The code files that were parsed and matched. */
  filesMatched: number;
  parseErrors: { path: string; message: string }[];
  /** Rejected `flagops.json` files or entries, with reasons. */
  accessorProblems: AccessorProblem[];
  /** The rule IDs of the accessors that passed validation. */
  accessorRules: string[];
};

type Module = ParsedModule & { lines: SourceLines; isTest: boolean };

function parseModules(files: readonly RepositoryFile[]): {
  modules: Module[];
  errors: MatchResult['parseErrors'];
} {
  const modules: Module[] = [];
  const errors: MatchResult['parseErrors'] = [];
  for (const file of files) {
    const parsed = parseSource(file.path, file.text);
    if (!parsed.ok) {
      errors.push({ path: file.path, message: parsed.message });
      continue;
    }
    const lines = sourceLines(file.text);
    modules.push({
      path: file.path,
      text: file.text,
      ast: parsed.ast,
      lines,
      line: (offset) => lines.position(offset).line,
      isTest: isTestLike(file.path),
    });
  }
  return { modules, errors };
}

export function matchRepository(
  files: readonly RepositoryFile[],
  flagNames: readonly string[],
): MatchResult {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const { config, problems } = parseAccessorConfig(byPath.get(accessorConfigPath));
  const excluded = ignore().add(config.exclude);
  const codeFiles = files
    .filter((file) => isCodeFile(file.path) && !excluded.ignores(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const { modules, errors } = parseModules(codeFiles);
  const resolver = createModuleResolver(
    modules.map((module) => module.path),
    byPath.get('tsconfig.json') ?? byPath.get('jsconfig.json'),
  );
  const packages = createPackageContext(
    new Map(
      files
        .filter((file) => posix.basename(file.path) === 'package.json')
        .map((file) => [file.path, file.text]),
    ),
  );
  const clientExpressions = new Set(config.clients.map((client) => client.expression));
  const index = buildRepositoryIndex(modules, resolver, clientExpressions);
  const classified = modules.map((module) => ({
    module,
    classifier: new Classifier(module.path, module.text, index, clientExpressions),
  }));
  const byModulePath = new Map(classified.map((entry) => [entry.module.path, entry]));
  const moduleByPath = new Map(modules.map((module) => [module.path, module]));

  function readContext(file: string, accessors: readonly ValidAccessor[]): ReadContext {
    const entry = byModulePath.get(file);
    if (entry === undefined) {
      throw new Error(`No parsed module ${file}`);
    }
    return {
      file,
      classifier: entry.classifier,
      products: packages.productsOf(file),
      index,
      line: entry.module.line,
      accessorCall: (call) => accessorCallOf(call, file, accessors, index),
    };
  }

  const validation = validateAccessors(config.accessors, moduleByPath, index, readContext);
  const accessorParameters = new Set<t.Identifier>(
    validation.accessors.map((accessor) => accessor.parameter),
  );
  const resolveName = createNameResolver(flagNames);
  const records: CodeRecord[] = [];
  const consumed = new Map<string, Set<number>>();
  const patternKeys = new Map<string, Set<number>>();
  for (const module of modules) {
    const match = matchFile(module.ast, {
      ...readContext(module.path, validation.accessors),
      text: module.text,
      lines: module.lines,
      isTest: module.isTest,
      resolveName,
      exported: index,
      accessorParameters,
    });
    records.push(...match.records);
    patternKeys.set(module.path, match.patternKeys);
    for (const origin of match.consumed) {
      const offsets = consumed.get(origin.file) ?? new Set<number>();
      offsets.add(origin.start);
      consumed.set(origin.file, offsets);
    }
  }
  for (const { module, classifier } of classified) {
    const products = packages.productsOf(module.path);
    records.push(
      ...findMentions(module.ast, {
        file: module.path,
        isTest: module.isTest,
        clientPackage: products.has('client') || products.has('react'),
        flagNames,
        classifier,
        lines: module.lines,
        consumed: consumed.get(module.path) ?? new Set(),
        patternKeys: patternKeys.get(module.path) ?? new Set(),
      }),
    );
  }
  return {
    records: records.sort(compareRecords),
    filesMatched: modules.length,
    parseErrors: errors,
    accessorProblems: [...problems, ...validation.problems],
    accessorRules: validation.accessors.map((accessor) => accessor.rule).sort(),
  };
}

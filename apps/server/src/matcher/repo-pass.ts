import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ModuleResolver } from './module-resolver.js';
import {
  enumMembersOf,
  importOf,
  literalOf,
  stringObjectOf,
  type ExportedStrings,
  type StaticString,
} from './names.js';
import { traverse } from './parse.js';
import { Classifier, type ExportedSdk, type Traced } from './receivers.js';
import { objectWrappers, wrapperOf, type Wrapper } from './wrappers.js';

/**
 * The repository pass (architecture.md 8.3, D-043): what each module exports that the matcher
 * cares about, collected in rounds until nothing changes, so an export that depends on another
 * module's export resolves. Re-exports are links, followed at lookup time.
 */
export type ParsedModule = {
  path: string;
  text: string;
  ast: t.File;
  line: (offset: number) => number;
};

type ModuleExports = {
  sdk: Map<string, Traced>;
  strings: Map<string, StaticString>;
  objects: Map<string, Map<string, StaticString>>;
  /** By export name, or `Export.method` for an exported object's methods. */
  wrappers: Map<string, Wrapper>;
  /** Exports defined in this module: export name to local binding name. */
  locals: Map<string, string>;
  reexports: Map<string, { source: string; imported: string }>;
  starSources: string[];
};

/** Where an export is defined: the module and the local binding name. */
export type Definition = { file: string; local: string };

export type RepositoryIndex = ExportedSdk &
  ExportedStrings & {
    lookupWrapper(fromFile: string, specifier: string, exported: string): Wrapper | undefined;
    /** The definition an import refers to, after following re-exports. */
    origin(fromFile: string, specifier: string, exported: string): Definition | undefined;
    /** The definition of a module's own export, after following re-exports. */
    definition(file: string, exported: string): Definition | undefined;
  };

const maxRounds = 5;

function emptyExports(): ModuleExports {
  return {
    sdk: new Map(),
    strings: new Map(),
    objects: new Map(),
    wrappers: new Map(),
    locals: new Map(),
    reexports: new Map(),
    starSources: [],
  };
}

function topLevelEnum(program: t.Program, name: string): t.TSEnumDeclaration | undefined {
  return program.body
    .map((statement) => (t.isExportNamedDeclaration(statement) ? statement.declaration : statement))
    .find(
      (node): node is t.TSEnumDeclaration => t.isTSEnumDeclaration(node) && node.id.name === name,
    );
}

function scanModule(module: ParsedModule, classifier: Classifier): ModuleExports {
  const exports = emptyExports();
  const sdkKinds = new Set(['client', 'node-client', 'flags']);

  function record(
    exported: string,
    value: NodePath<t.Node | null | undefined>,
    local: string,
  ): void {
    exports.locals.set(exported, local);
    if (!value.hasNode()) {
      return;
    }
    const traced = classifier.classify(value);
    if (traced !== undefined && sdkKinds.has(traced.kind)) {
      exports.sdk.set(exported, traced);
    }
    const literal = literalOf(value.node, module.path);
    if (literal !== undefined) {
      exports.strings.set(exported, literal);
    }
    const object = stringObjectOf(value.node, module.path);
    if (object !== undefined) {
      exports.objects.set(exported, object);
    }
    const wrapper = wrapperOf(value, classifier, module.path, module.line);
    if (wrapper !== undefined) {
      exports.wrappers.set(exported, wrapper);
    }
    for (const [method, objectWrapper] of objectWrappers(
      value,
      classifier,
      module.path,
      module.line,
    )) {
      exports.wrappers.set(`${exported}.${method}`, objectWrapper);
    }
  }

  function recordBinding(
    exported: string,
    identifier: NodePath<t.Identifier>,
    program: t.Program,
  ): void {
    const name = identifier.node.name;
    const imported = importOf(identifier, name);
    if (imported !== undefined) {
      exports.reexports.set(exported, imported);
      return;
    }
    const declaration = identifier.scope.getBinding(name)?.path;
    if (declaration?.isVariableDeclarator() === true) {
      record(exported, declaration.get('init'), name);
      const traced = classifier.classify(identifier);
      if (traced !== undefined && sdkKinds.has(traced.kind)) {
        exports.sdk.set(exported, traced);
      }
      return;
    }
    if (declaration !== undefined) {
      record(exported, declaration, name);
      return;
    }
    // Babel keeps no bindings for TypeScript enums.
    const enumDeclaration = topLevelEnum(program, name);
    if (enumDeclaration !== undefined) {
      exports.locals.set(exported, name);
      exports.objects.set(exported, enumMembersOf(enumDeclaration, module.path));
    }
  }

  traverse(module.ast, {
    Program(program) {
      for (const statement of program.get('body')) {
        scanStatement(statement, program.node);
      }
      program.stop();
    },
  });

  function scanStatement(statement: NodePath, program: t.Program): void {
    if (statement.isExportAllDeclaration()) {
      exports.starSources.push(statement.node.source.value);
      return;
    }
    if (statement.isExportDefaultDeclaration()) {
      const declaration = statement.get('declaration') as NodePath;
      if (declaration.isIdentifier()) {
        recordBinding('default', declaration, program);
      } else {
        const id = (declaration.node as { id?: t.Identifier | null }).id;
        record('default', declaration, id?.name ?? 'default');
      }
      return;
    }
    if (statement.isExportNamedDeclaration()) {
      scanNamedExport(statement, program);
      return;
    }
    if (statement.isExpressionStatement()) {
      scanCommonJs(statement.get('expression'));
    }
  }

  function scanNamedExport(
    statement: NodePath<t.ExportNamedDeclaration>,
    program: t.Program,
  ): void {
    const source = statement.node.source?.value;
    for (const specifier of statement.get('specifiers')) {
      if (!specifier.isExportSpecifier()) {
        continue;
      }
      const exportedNode = specifier.node.exported;
      const exported = t.isIdentifier(exportedNode) ? exportedNode.name : exportedNode.value;
      if (source !== undefined) {
        exports.reexports.set(exported, { source, imported: specifier.node.local.name });
      } else {
        recordBinding(exported, specifier.get('local'), program);
      }
    }
    const declaration = statement.get('declaration') as NodePath;
    if (declaration.isVariableDeclaration()) {
      for (const declarator of declaration.get('declarations')) {
        if (t.isIdentifier(declarator.node.id)) {
          record(declarator.node.id.name, declarator.get('init'), declarator.node.id.name);
        }
      }
    } else if (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) {
      const id = declaration.node.id;
      if (id !== null && id !== undefined) {
        record(id.name, declaration, id.name);
      }
    } else if (declaration.isTSEnumDeclaration()) {
      const name = declaration.node.id.name;
      exports.locals.set(name, name);
      exports.objects.set(name, enumMembersOf(declaration.node, module.path));
    }
  }

  /** `module.exports = x`, `module.exports.name = x` and `exports.name = x`. */
  function scanCommonJs(expression: NodePath): void {
    if (!expression.isAssignmentExpression()) {
      return;
    }
    const left = expression.node.left;
    const right = expression.get('right');
    if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property)) {
      return;
    }
    const isModuleExports = (node: t.Node) =>
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object, { name: 'module' }) &&
      t.isIdentifier(node.property, { name: 'exports' });
    if (isModuleExports(left)) {
      record('default', right, 'default');
    } else if (isModuleExports(left.object) || t.isIdentifier(left.object, { name: 'exports' })) {
      record(left.property.name, right, left.property.name);
    }
  }

  return exports;
}

function signature(all: Map<string, ModuleExports>): string {
  return [...all]
    .map(
      ([path, e]) => `${path}:${e.sdk.size}/${e.strings.size}/${e.objects.size}/${e.wrappers.size}`,
    )
    .join('|');
}

export function buildRepositoryIndex(
  modules: readonly ParsedModule[],
  resolver: ModuleResolver,
  clientExpressions: ReadonlySet<string>,
): RepositoryIndex {
  let exportsByFile = new Map<string, ModuleExports>();

  /** Follows re-exports from `file`'s export `name` until `pick` finds something. */
  function follow<T>(
    file: string,
    name: string,
    pick: (exports: ModuleExports, file: string, name: string) => T | undefined,
    seen = new Set<string>(),
  ): T | undefined {
    const key = `${file}#${name}`;
    const exports = exportsByFile.get(file);
    if (seen.has(key) || exports === undefined) {
      return undefined;
    }
    seen.add(key);
    const own = pick(exports, file, name);
    if (own !== undefined) {
      return own;
    }
    const link = exports.reexports.get(name);
    if (link !== undefined) {
      const target = resolver.resolve(file, link.source);
      return target.kind === 'file' ? follow(target.path, link.imported, pick, seen) : undefined;
    }
    for (const source of name === 'default' ? [] : exports.starSources) {
      const target = resolver.resolve(file, source);
      const hit = target.kind === 'file' ? follow(target.path, name, pick, seen) : undefined;
      if (hit !== undefined) {
        return hit;
      }
    }
    return undefined;
  }

  function lookup<T>(
    fromFile: string,
    specifier: string,
    exported: string,
    pick: (exports: ModuleExports, file: string, name: string) => T | undefined,
  ): T | undefined {
    const target = resolver.resolve(fromFile, specifier);
    return target.kind === 'file' ? follow(target.path, exported, pick) : undefined;
  }

  function definedLocal(
    exports: ModuleExports,
    file: string,
    name: string,
  ): Definition | undefined {
    const local = exports.locals.get(name);
    return local === undefined ? undefined : { file, local };
  }

  const index: RepositoryIndex = {
    lookupSdk: (from, specifier, exported) =>
      lookup(from, specifier, exported, (exports, _, name) => exports.sdk.get(name)),
    stringOf: (from, specifier, exported) =>
      lookup(from, specifier, exported, (exports, _, name) => exports.strings.get(name)),
    memberOf: (from, specifier, exported, key) =>
      lookup(from, specifier, exported, (exports, _, name) => exports.objects.get(name)?.get(key)),
    lookupWrapper: (from, specifier, exported) => {
      const [name = exported, method] = exported.split('.');
      return lookup(from, specifier, name, (exports, _, found) =>
        exports.wrappers.get(method === undefined ? found : `${found}.${method}`),
      );
    },
    origin: (from, specifier, exported) => lookup(from, specifier, exported, definedLocal),
    definition: (file, exported) => follow(file, exported, definedLocal),
  };

  for (let round = 0; round < maxRounds; round += 1) {
    const before = signature(exportsByFile);
    const next = new Map<string, ModuleExports>();
    for (const module of modules) {
      const classifier = new Classifier(module.path, module.text, index, clientExpressions);
      next.set(module.path, scanModule(module, classifier));
    }
    exportsByFile = next;
    if (signature(exportsByFile) === before) {
      break;
    }
  }
  return index;
}

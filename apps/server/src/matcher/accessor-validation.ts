import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  accessorRuleId,
  describeEntry,
  type AccessorEntry,
  type AccessorProblem,
} from './accessor-config.js';
import type { MatchedEntry, ValidAccessor } from './accessor-calls.js';
import { propertyKey } from './names.js';
import { traverse } from './parse.js';
import type { Definition, ParsedModule, RepositoryIndex } from './repo-pass.js';
import type { Product } from './sdk-modules.js';
import { readSiteOf, type Call, type ReadContext } from './sdk-reads.js';

/**
 * Validating `flagops.json` entries before use (survey 4.3, rule 5): the module and export exist,
 * and the accessor's body passes its name parameter to a Flagsmith read or to another validated
 * accessor. FlagOps never trusts an entry blindly.
 */
type Outcome = { ok: true; accessor: ValidAccessor } | { ok: false; reason: string };

/** The program-level path that declares a module's local binding. */
function declarationOf(module: ParsedModule, local: string): NodePath | undefined {
  let found: NodePath | undefined;
  traverse(module.ast, {
    Program(program) {
      found = program.scope.getBinding(local)?.path;
      program.stop();
    },
  });
  return found;
}

function asFunction(path: NodePath | null | undefined): NodePath<t.Function> | undefined {
  if (path === null || path === undefined) {
    return undefined;
  }
  if (path.isFunction()) {
    return path;
  }
  if (path.isVariableDeclarator()) {
    return asFunction(path.get('init') as NodePath);
  }
  // useCallback(fn, deps) and similar wrappers hand back their first argument.
  if (path.isCallExpression()) {
    return asFunction((path.get('arguments') as NodePath[])[0]);
  }
  return undefined;
}

function methodFunction(declaration: NodePath, method: string): NodePath<t.Function> | undefined {
  const holder = declaration.isVariableDeclarator()
    ? (declaration.get('init') as NodePath)
    : declaration;
  if (holder.isObjectExpression()) {
    for (const property of holder.get('properties')) {
      if (
        (property.isObjectMethod() || property.isObjectProperty()) &&
        propertyKey(property.node.key, property.node.computed) === method
      ) {
        return property.isObjectMethod() ? property : asFunction(property.get('value'));
      }
    }
  }
  if (holder.isClass()) {
    for (const member of holder.get('body').get('body')) {
      if (
        member.isClassMethod({ kind: 'method' }) &&
        propertyKey(member.node.key, member.node.computed) === method
      ) {
        return member;
      }
      if (
        member.isClassProperty() &&
        propertyKey(member.node.key, member.node.computed) === method
      ) {
        return asFunction(member.get('value') as NodePath);
      }
    }
  }
  return undefined;
}

/** The function behind `member` in the object a hook returns. */
function returnedMember(
  hook: NodePath<t.Function>,
  member: string,
): NodePath<t.Function> | undefined {
  let found: NodePath<t.Function> | undefined;
  hook.traverse({
    Function(inner) {
      inner.skip();
    },
    ReturnStatement(statement) {
      const argument = statement.get('argument') as NodePath;
      if (found !== undefined || !argument.isObjectExpression()) {
        return;
      }
      for (const property of argument.get('properties')) {
        if (!property.isObjectProperty() && !property.isObjectMethod()) {
          continue;
        }
        if (propertyKey(property.node.key, property.node.computed) !== member) {
          continue;
        }
        if (property.isObjectMethod()) {
          found = property;
          return;
        }
        const value = property.get('value') as NodePath;
        found = value.isIdentifier()
          ? asFunction(value.scope.getBinding(value.node.name)?.path)
          : asFunction(value);
      }
    },
  });
  return found;
}

function targetFunction(entry: MatchedEntry, declaration: NodePath): NodePath<t.Function> | string {
  if (entry.kind === 'method') {
    return methodFunction(declaration, entry.method) ?? `has no method ${entry.method}`;
  }
  const fn = asFunction(declaration);
  if (fn === undefined) {
    return 'is not a function';
  }
  if (entry.kind === 'hook-result') {
    return returnedMember(fn, entry.member) ?? `does not return a member ${entry.member}`;
  }
  return fn;
}

function nameParameter(fn: NodePath<t.Function>, position: number): t.Identifier | undefined {
  const parameter = fn.node.params[position];
  if (t.isIdentifier(parameter)) {
    return parameter;
  }
  return t.isAssignmentPattern(parameter) && t.isIdentifier(parameter.left)
    ? parameter.left
    : undefined;
}

/**
 * The product of the first read in the body that receives the parameter, or undefined. A
 * flags-object accessor's parameter is a list of names, so it must reach a list-shaped read whole:
 * `useFlags(names)` or another flags-object accessor. Any other accessor passes one name.
 */
function readOfParameter(
  fn: NodePath<t.Function>,
  parameter: t.Identifier,
  takesList: boolean,
  context: ReadContext,
): Product | undefined {
  const isParameter = (name: NodePath | undefined): boolean =>
    name?.isIdentifier() === true &&
    name.scope.getBinding(name.node.name)?.identifier === parameter;
  let product: Product | undefined;
  fn.traverse({
    'CallExpression|OptionalCallExpression'(path: NodePath) {
      if (product !== undefined) {
        return;
      }
      const site = readSiteOf(path as Call, context);
      if (site?.kind !== 'read') {
        return;
      }
      if (takesList ? isParameter(site.list) : site.names.some(isParameter)) {
        product = site.product;
      }
    },
  });
  return product;
}

function validate(
  entry: MatchedEntry,
  modules: ReadonlyMap<string, ParsedModule>,
  index: RepositoryIndex,
  contextOf: (file: string) => ReadContext,
): Outcome {
  if (!modules.has(entry.module)) {
    return { ok: false, reason: `The module ${entry.module} is not among the scanned files.` };
  }
  const definition: Definition | undefined = index.definition(entry.module, entry.export);
  const module = definition === undefined ? undefined : modules.get(definition.file);
  const declaration =
    definition === undefined || module === undefined
      ? undefined
      : declarationOf(module, definition.local);
  if (definition === undefined || declaration === undefined) {
    return { ok: false, reason: `${entry.module} has no export named ${entry.export}.` };
  }
  const fn = targetFunction(entry, declaration);
  if (typeof fn === 'string') {
    return { ok: false, reason: `${entry.export} in ${definition.file} ${fn}.` };
  }
  const parameter = nameParameter(fn, entry.nameArg);
  if (parameter === undefined) {
    return {
      ok: false,
      reason: `Parameter ${entry.nameArg + 1} of ${entry.export} is not a plain name.`,
    };
  }
  const takesList = entry.reads === 'flags-object';
  const read = readOfParameter(fn, parameter, takesList, contextOf(definition.file));
  if (read === undefined) {
    return {
      ok: false,
      reason: takesList
        ? `${entry.export} in ${definition.file} does not pass parameter ${entry.nameArg + 1}, its list of names, to useFlags or to another flags-object accessor.`
        : `${entry.export} in ${definition.file} does not pass parameter ${entry.nameArg + 1} to a Flagsmith read or to another configured accessor.`,
    };
  }
  const product: Product = entry.sdk ?? read;
  return {
    ok: true,
    accessor: { entry, rule: accessorRuleId(entry), product, definition, parameter },
  };
}

/**
 * Validates the entries in rounds, so an accessor that calls another configured accessor is valid
 * once that one is. `contextOf` builds a file's read context from the accessors valid so far.
 */
export function validateAccessors(
  entries: readonly AccessorEntry[],
  modules: ReadonlyMap<string, ParsedModule>,
  index: RepositoryIndex,
  contextOf: (file: string, accessors: readonly ValidAccessor[]) => ReadContext,
): { accessors: ValidAccessor[]; problems: AccessorProblem[] } {
  const valid: ValidAccessor[] = [];
  const problems: AccessorProblem[] = [];
  let pending = entries.map((entry, position) => ({ entry, position }));
  for (const { entry, position } of pending) {
    if (entry.kind === 'component') {
      problems.push({
        entry: describeEntry(entry, position),
        reason:
          'Component accessors are not matched yet, so the flag names passed to them count as mentions.',
      });
    }
  }
  pending = pending.filter(({ entry }) => entry.kind !== 'component');
  const reasons = new Map<number, string>();
  for (let progress = true; progress && pending.length > 0;) {
    progress = false;
    for (const item of pending) {
      const outcome = validate(item.entry as MatchedEntry, modules, index, (file) =>
        contextOf(file, valid),
      );
      if (outcome.ok) {
        valid.push(outcome.accessor);
        progress = true;
      } else {
        reasons.set(item.position, outcome.reason);
      }
    }
    pending = pending.filter(({ entry }) => !valid.some((accessor) => accessor.entry === entry));
  }
  for (const { entry, position } of pending) {
    problems.push({
      entry: describeEntry(entry, position),
      reason: reasons.get(position) ?? 'It could not be validated.',
    });
  }
  return { accessors: valid, problems: problems.sort((a, b) => a.entry.localeCompare(b.entry)) };
}

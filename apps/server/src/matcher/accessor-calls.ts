import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { AccessorEntry } from './accessor-config.js';
import { importOf, propertyKey } from './names.js';
import type { Definition, RepositoryIndex } from './repo-pass.js';
import { memberName } from './receivers.js';
import type { Product } from './sdk-modules.js';
import { nameList, type AccessorCall, type Call } from './sdk-reads.js';

/**
 * Matching the call sites of configured accessors (survey 4.3, rule 1): only by binding, through
 * imports and re-exports, so a function with the same name elsewhere never matches.
 */
export type MatchedEntry = Exclude<AccessorEntry, { kind: 'component' }>;

export type ValidAccessor = {
  entry: MatchedEntry;
  rule: string;
  /** The name rule of the SDK the accessor wraps. */
  product: Product;
  definition: Definition;
  /** The accessor's own name parameter: its SDK read inside the body is not a dynamic reference. */
  parameter: t.Identifier;
};

function sameDefinition(a: Definition | undefined, b: Definition): boolean {
  return a !== undefined && a.file === b.file && a.local === b.local;
}

/** The definition an identifier or a namespace member refers to. */
export function definitionOf(
  path: NodePath,
  file: string,
  index: RepositoryIndex,
): Definition | undefined {
  if (path.isIdentifier()) {
    const name = path.node.name;
    const binding = path.scope.getBinding(name);
    if (binding === undefined) {
      return undefined;
    }
    const imported = importOf(path, name);
    if (imported !== undefined) {
      return index.origin(file, imported.source, imported.imported);
    }
    return binding.scope.path.isProgram() ? { file, local: name } : undefined;
  }
  if (path.isMemberExpression() && t.isIdentifier(path.node.object)) {
    const binding = path.scope.getBinding(path.node.object.name);
    const member = memberName(path);
    if (binding?.path.isImportNamespaceSpecifier() === true && member !== undefined) {
      const source = (binding.path.parentPath.node as t.ImportDeclaration).source.value;
      return index.origin(file, source, member);
    }
  }
  return undefined;
}

/** A call to the definition, possibly awaited: `useFlagChecks()`. */
function callsDefinition(
  path: NodePath | null | undefined,
  target: Definition,
  file: string,
  index: RepositoryIndex,
): boolean {
  const call = path?.isAwaitExpression() === true ? path.get('argument') : path;
  if (call?.isCallExpression() !== true) {
    return false;
  }
  return sameDefinition(definitionOf(call.get('callee'), file, index), target);
}

/** The type a class field or a constructor parameter property is annotated with. */
function annotatedClassOf(object: NodePath, field: string): NodePath | undefined {
  const owner = object.findParent((parent) => parent.isClass());
  if (owner === null || !owner.isClass()) {
    return undefined;
  }
  for (const member of owner.get('body').get('body')) {
    if (member.isClassProperty() && propertyKey(member.node.key, member.node.computed) === field) {
      return member.get('typeAnnotation') as NodePath;
    }
    if (member.isClassMethod({ kind: 'constructor' })) {
      for (const parameter of member.get('params')) {
        const inner = parameter.isTSParameterProperty() ? parameter.get('parameter') : undefined;
        if (inner?.isIdentifier({ name: field }) === true) {
          return inner.get('typeAnnotation') as NodePath;
        }
      }
    }
  }
  return undefined;
}

function annotationNames(
  annotation: NodePath | undefined,
  target: Definition,
  file: string,
  index: RepositoryIndex,
): boolean {
  const reference =
    annotation?.isTSTypeAnnotation() === true
      ? (annotation.get('typeAnnotation') as NodePath)
      : undefined;
  if (reference?.isTSTypeReference() !== true) {
    return false;
  }
  const name = reference.get('typeName') as NodePath;
  return name.isIdentifier() && sameDefinition(definitionOf(name, file, index), target);
}

/** `Obj.method`, `new Service().method`, a local `new Service()`, or `this.<typed field>.method`. */
function methodReceiver(
  object: NodePath,
  target: Definition,
  file: string,
  index: RepositoryIndex,
): boolean {
  if (sameDefinition(definitionOf(object, file, index), target)) {
    return true;
  }
  if (object.isNewExpression()) {
    return sameDefinition(definitionOf(object.get('callee'), file, index), target);
  }
  if (object.isIdentifier()) {
    const binding = object.scope.getBinding(object.node.name);
    const init =
      binding?.path.isVariableDeclarator() === true
        ? (binding.path.get('init') as NodePath)
        : undefined;
    return init?.isNewExpression() === true && methodReceiver(init, target, file, index);
  }
  if (object.isMemberExpression() && t.isThisExpression(object.node.object)) {
    const field = memberName(object);
    return (
      field !== undefined && annotationNames(annotatedClassOf(object, field), target, file, index)
    );
  }
  return false;
}

/** `isEnabled` destructured from the hook's result, or `checks.isEnabled` on it. */
function hookResultMember(
  callee: NodePath,
  member: string,
  target: Definition,
  file: string,
  index: RepositoryIndex,
): boolean {
  if (callee.isIdentifier()) {
    const binding = callee.scope.getBinding(callee.node.name);
    const declarator = binding?.path;
    if (declarator?.isVariableDeclarator() !== true || !t.isObjectPattern(declarator.node.id)) {
      return false;
    }
    const property = declarator.node.id.properties.find(
      (item): item is t.ObjectProperty =>
        t.isObjectProperty(item) &&
        propertyKey(item.key, item.computed) === member &&
        (t.isIdentifier(item.value, { name: callee.node.name }) ||
          (t.isAssignmentPattern(item.value) &&
            t.isIdentifier(item.value.left, { name: callee.node.name }))),
    );
    return (
      property !== undefined &&
      callsDefinition(declarator.get('init') as NodePath, target, file, index)
    );
  }
  if (!callee.isMemberExpression() || memberName(callee) !== member) {
    return false;
  }
  const object = callee.get('object') as NodePath;
  if (callsDefinition(object, target, file, index)) {
    return true;
  }
  const binding = object.isIdentifier() ? object.scope.getBinding(object.node.name) : undefined;
  return (
    binding?.path.isVariableDeclarator() === true &&
    t.isIdentifier(binding.path.node.id) &&
    callsDefinition(binding.path.get('init') as NodePath, target, file, index)
  );
}

function matches(
  accessor: ValidAccessor,
  callee: NodePath,
  file: string,
  index: RepositoryIndex,
): boolean {
  const { entry, definition } = accessor;
  switch (entry.kind) {
    case 'function':
    case 'hook':
      return sameDefinition(definitionOf(callee, file, index), definition);
    case 'method':
      return (
        callee.isMemberExpression() &&
        memberName(callee) === entry.method &&
        methodReceiver(callee.get('object'), definition, file, index)
      );
    case 'hook-result':
      return hookResultMember(callee, entry.member, definition, file, index);
  }
}

function methodOf(entry: MatchedEntry): string {
  return entry.kind === 'method'
    ? entry.method
    : entry.kind === 'hook-result'
      ? entry.member
      : entry.export;
}

/** The configured accessor a call goes to, with its flag-name arguments. */
export function accessorCallOf(
  call: Call,
  file: string,
  accessors: readonly ValidAccessor[],
  index: RepositoryIndex,
): AccessorCall | undefined {
  const callee = call.get('callee');
  const accessor = accessors.find((candidate) => matches(candidate, callee, file, index));
  if (accessor === undefined) {
    return undefined;
  }
  const argument = (call.get('arguments') as NodePath[])[accessor.entry.nameArg];
  const list =
    accessor.entry.reads === 'flags-object'
      ? nameList(argument)
      : { names: argument === undefined ? [] : [argument], dynamic: false };
  return {
    rule: accessor.rule,
    method: methodOf(accessor.entry),
    product: accessor.product,
    via: `${methodOf(accessor.entry)}(), a ${accessor.entry.kind} accessor declared in flagops.json (${accessor.entry.module})`,
    names: list.names,
    listIsDynamic: list.dynamic,
  };
}

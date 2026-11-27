import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Static flag names (architecture.md 8.3): literals, same-module constants, const objects and
 * string enums, and constants other modules export. Each value keeps the position of the literal
 * that holds it, so a constant that resolved into a reference is not also counted as a mention.
 */

/** Where a string literal sits: its file and the offset of its first character. */
export type Origin = { file: string; start: number };

export type StaticString = { value: string; origin: Origin };

export type NameResult = { kind: 'static'; value: string; origin: Origin } | { kind: 'dynamic' };

/** Looks up what another module exports, through the repository pass. */
export type ExportedStrings = {
  stringOf(fromFile: string, specifier: string, exported: string): StaticString | undefined;
  memberOf(
    fromFile: string,
    specifier: string,
    exported: string,
    key: string,
  ): StaticString | undefined;
};

function unwrapped(node: t.Node): t.Node {
  return t.isTSAsExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isTSNonNullExpression(node)
    ? unwrapped(node.expression)
    : node;
}

/** A string literal, or a template literal without substitutions, looking through `as const`. */
export function literalOf(node: t.Node | null | undefined, file: string): StaticString | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }
  const inner = unwrapped(node);
  if (t.isStringLiteral(inner)) {
    return { value: inner.value, origin: { file, start: inner.start ?? 0 } };
  }
  if (t.isTemplateLiteral(inner) && inner.expressions.length === 0) {
    const cooked = inner.quasis[0]?.value.cooked;
    return cooked === undefined
      ? undefined
      : { value: cooked, origin: { file, start: inner.start ?? 0 } };
  }
  return undefined;
}

export function propertyKey(key: t.Node, computed: boolean): string | undefined {
  if (!computed && t.isIdentifier(key)) {
    return key.name;
  }
  return t.isStringLiteral(key) ? key.value : undefined;
}

/** `{ A: 'a' }`, with `as const` or `Object.freeze(...)`, as a map from key to literal. */
export function stringObjectOf(
  node: t.Node | null | undefined,
  file: string,
): Map<string, StaticString> | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }
  const inner = unwrapped(node);
  const frozen =
    t.isCallExpression(inner) &&
    t.isMemberExpression(inner.callee) &&
    t.isIdentifier(inner.callee.object, { name: 'Object' }) &&
    t.isIdentifier(inner.callee.property, { name: 'freeze' });
  if (frozen) {
    return stringObjectOf(inner.arguments[0], file);
  }
  if (!t.isObjectExpression(inner)) {
    return undefined;
  }
  const members = new Map<string, StaticString>();
  for (const property of inner.properties) {
    if (!t.isObjectProperty(property)) {
      continue;
    }
    const key = propertyKey(property.key, property.computed);
    const value = literalOf(property.value, file);
    if (key !== undefined && value !== undefined) {
      members.set(key, value);
    }
  }
  return members.size > 0 ? members : undefined;
}

/** A TypeScript enum's string members. */
export function enumMembersOf(
  declaration: t.TSEnumDeclaration,
  file: string,
): Map<string, StaticString> {
  const members = new Map<string, StaticString>();
  // Babel 7 puts the members on the declaration; Babel 8 moves them to `body`.
  const list = declaration.members as t.TSEnumMember[] | undefined;
  for (const member of list ?? []) {
    const key = t.isIdentifier(member.id) ? member.id.name : member.id.value;
    const value = literalOf(member.initializer, file);
    if (value !== undefined) {
      members.set(key, value);
    }
  }
  return members;
}

function topLevelEnum(path: NodePath, name: string): t.TSEnumDeclaration | undefined {
  const program = path.findParent((parent) => parent.isProgram())?.node as t.Program | undefined;
  for (const statement of program?.body ?? []) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (t.isTSEnumDeclaration(declaration) && declaration.id.name === name) {
      return declaration;
    }
  }
  return undefined;
}

/** The exported name an import specifier asks for: `default` for a default import. */
export function importedName(specifier: t.ImportSpecifier | t.ImportDefaultSpecifier): string {
  if (t.isImportDefaultSpecifier(specifier)) {
    return 'default';
  }
  return t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
}

/** The module and export an identifier is imported as, when it is an import binding. */
export function importOf(
  path: NodePath,
  name: string,
): { source: string; imported: string } | undefined {
  const specifier = path.scope.getBinding(name)?.path;
  if (specifier === undefined) {
    return undefined;
  }
  if (specifier.isImportDefaultSpecifier() || specifier.isImportSpecifier()) {
    const declaration = specifier.parentPath.node as t.ImportDeclaration;
    return { source: declaration.source.value, imported: importedName(specifier.node) };
  }
  return undefined;
}

const dynamic: NameResult = { kind: 'dynamic' };

/** Resolves a flag-name argument statically, or says it is dynamic. */
export function resolveStaticName(
  path: NodePath,
  file: string,
  exported: ExportedStrings,
): NameResult {
  const node = unwrapped(path.node);
  const literal = literalOf(node, file);
  if (literal !== undefined) {
    return { kind: 'static', ...literal };
  }
  if (t.isIdentifier(node)) {
    const binding = path.scope.getBinding(node.name);
    if (binding?.constant === true && binding.path.isVariableDeclarator()) {
      const value = literalOf(binding.path.node.init, file);
      if (value !== undefined) {
        return { kind: 'static', ...value };
      }
    }
    const imported = importOf(path, node.name);
    const value =
      imported === undefined
        ? undefined
        : exported.stringOf(file, imported.source, imported.imported);
    return value === undefined ? dynamic : { kind: 'static', ...value };
  }
  if (t.isMemberExpression(node) && t.isIdentifier(node.object)) {
    const key = propertyKey(node.property, node.computed);
    if (key === undefined) {
      return dynamic;
    }
    const objectName = node.object.name;
    const binding = path.scope.getBinding(objectName);
    if (binding?.constant === true && binding.path.isVariableDeclarator()) {
      const value = stringObjectOf(binding.path.node.init, file)?.get(key);
      if (value !== undefined) {
        return { kind: 'static', ...value };
      }
    }
    const enumDeclaration = topLevelEnum(path, objectName);
    const enumValue =
      enumDeclaration === undefined ? undefined : enumMembersOf(enumDeclaration, file).get(key);
    if (enumValue !== undefined) {
      return { kind: 'static', ...enumValue };
    }
    const imported = importOf(path, objectName);
    const value =
      imported === undefined
        ? undefined
        : exported.memberOf(file, imported.source, imported.imported, key);
    return value === undefined ? dynamic : { kind: 'static', ...value };
  }
  return dynamic;
}

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { importOf, literalOf, propertyKey } from './names.js';
import { traverse } from './parse.js';
import type { CodeRecord, SourceLines } from './records.js';
import { mentionedFlags } from './resolve-name.js';
import { memberName, type Classifier } from './receivers.js';
import { sdkModule } from './sdk-modules.js';

/**
 * Mentions (architecture.md 8.3, D-044): string literals, template literals without substitutions
 * and object keys whose text names a flag. The name arguments of matched reads, the constants
 * that resolved into them, and the keys of `useFlags` destructuring are not mentions. A key of a
 * `defaultFlags` object passed to the client's `init()` or to `FlagsmithProvider` is rule D1.
 */
export type MentionContext = {
  file: string;
  isTest: boolean;
  clientPackage: boolean;
  flagNames: readonly string[];
  classifier: Classifier;
  lines: SourceLines;
  /** Offsets in this file that a matched read consumed. */
  consumed: ReadonlySet<number>;
  patternKeys: ReadonlySet<number>;
};

function isModuleSource(path: NodePath): boolean {
  const parent = path.parentPath;
  return (
    parent !== null &&
    (parent.isImportDeclaration() ||
      parent.isExportAllDeclaration() ||
      parent.isExportNamedDeclaration() ||
      parent.isImportExpression() ||
      (parent.isCallExpression() &&
        (t.isImport(parent.node.callee) ||
          t.isIdentifier(parent.node.callee, { name: 'require' }))))
  );
}

/** `<FlagsmithProvider options={{ defaultFlags }}>` with the provider from an SDK React module. */
function isProviderOptions(object: NodePath): boolean {
  const container = object.parentPath;
  if (container === null || !container.isJSXExpressionContainer()) {
    return false;
  }
  const attribute = container.parentPath;
  if (!attribute.isJSXAttribute() || !t.isJSXIdentifier(attribute.node.name, { name: 'options' })) {
    return false;
  }
  const element = attribute.parentPath;
  if (!element.isJSXOpeningElement() || !t.isJSXIdentifier(element.node.name)) {
    return false;
  }
  const imported = importOf(element, element.node.name.name);
  return (
    imported !== undefined &&
    sdkModule(imported.source) === 'react' &&
    imported.imported === 'FlagsmithProvider'
  );
}

/** A key of the `defaultFlags` object passed to a traced client's `init()` or to the provider. */
function isDefaultFlagsKey(property: NodePath<t.ObjectProperty>, classifier: Classifier): boolean {
  const holder = property.parentPath.parentPath;
  if (
    holder === null ||
    !holder.isObjectProperty() ||
    propertyKey(holder.node.key, holder.node.computed) !== 'defaultFlags'
  ) {
    return false;
  }
  const options = holder.parentPath;
  if (!options.isObjectExpression()) {
    return false;
  }
  const call = options.parentPath;
  if (call.isCallExpression() && call.node.arguments[0] === options.node) {
    const callee = call.get('callee');
    return (
      memberName(callee) === 'init' && classifier.classify(callee.get('object'))?.kind === 'client'
    );
  }
  return isProviderOptions(options);
}

export function findMentions(ast: t.File, context: MentionContext): CodeRecord[] {
  const records: CodeRecord[] = [];
  const add = (value: string, at: number, rule: 'mention' | 'D1', evidence: string): void => {
    if (context.consumed.has(at)) {
      return;
    }
    const position = context.lines.position(at);
    for (const flag of mentionedFlags(value, context.flagNames, context.clientPackage)) {
      records.push({
        kind: context.isTest ? 'test_mention' : 'mention',
        flagName: flag,
        literal: value,
        product: rule === 'D1' ? 'client' : null,
        ruleId: rule,
        method: null,
        filePath: context.file,
        line: position.line,
        column: position.column,
        traced: rule === 'D1',
        evidence,
        snippet: context.lines.snippet(position.line),
        suggestion: null,
      });
    }
  };
  traverse(ast, {
    'StringLiteral|TemplateLiteral'(path: NodePath) {
      const literal = literalOf(path.node, context.file);
      const parent = path.parentPath;
      const isKey = parent?.isObjectProperty() === true && parent.node.key === path.node;
      if (literal === undefined || isKey || isModuleSource(path)) {
        return;
      }
      add(literal.value, literal.origin.start, 'mention', 'a string that names the flag');
    },
    ObjectProperty(path) {
      const key = path.node.key;
      const name = propertyKey(key, path.node.computed);
      const at = key.start ?? 0;
      if (name === undefined || context.patternKeys.has(at)) {
        return;
      }
      if (path.parentPath.isObjectExpression() && isDefaultFlagsKey(path, context.classifier)) {
        add(name, at, 'D1', 'D1: a defaultFlags entry passed to the Flagsmith client');
        return;
      }
      add(name, at, 'mention', 'an object key that names the flag');
    },
  });
  return records;
}

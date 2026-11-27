import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { propertyKey } from './names.js';
import { memberName, type Classifier } from './receivers.js';
import { clientReads, nodeFlagsReads, type Product } from './sdk-modules.js';

/**
 * Pass-through wrappers (rule W1, D-043): `(name, ...) => <traced client or Flags>.<read>(name)`,
 * with an expression body or a single `return`. Anything with more logic needs an accessor entry
 * in `flagops.json` (survey 4.3).
 */
export type Wrapper = {
  /** The SDK method the wrapper calls, which decides the name rule. */
  method: string;
  product: Product;
  /** Where the wrapper is defined, as `file:line`. */
  where: string;
  /** The wrapper's name parameter, whose own SDK read is not a dynamic reference. */
  parameter: t.Identifier;
};

function returned(fn: NodePath<t.Function>): NodePath | undefined {
  const body = fn.get('body') as NodePath;
  if (!body.isBlockStatement()) {
    return body;
  }
  const statements = body.get('body');
  const [only] = statements;
  if (statements.length !== 1 || only?.isReturnStatement() !== true) {
    return undefined;
  }
  const argument = only.get('argument');
  return argument.hasNode() ? argument : undefined;
}

/** The wrapper a function is, or undefined. `line` turns an offset into a line number. */
export function wrapperOf(
  fn: NodePath,
  classifier: Classifier,
  file: string,
  line: (offset: number) => number,
): Wrapper | undefined {
  if (!fn.isFunction()) {
    return undefined;
  }
  const [parameter] = fn.node.params;
  if (!t.isIdentifier(parameter)) {
    return undefined;
  }
  const call = returned(fn);
  if (call?.isCallExpression() !== true) {
    return undefined;
  }
  const [argument, ...rest] = call.node.arguments;
  if (rest.length > 0 || !t.isIdentifier(argument, { name: parameter.name })) {
    return undefined;
  }
  const callee = call.get('callee') as NodePath;
  const method = memberName(callee);
  if (method === undefined) {
    return undefined;
  }
  if (!callee.isMemberExpression()) {
    return undefined;
  }
  const receiver = classifier.classify(callee.get('object'));
  const where = `${file}:${line(fn.node.start ?? 0)}`;
  if (receiver?.kind === 'client' && (method === 'hasFeature' || method === 'getValue')) {
    return { method, product: 'client', where, parameter };
  }
  if (
    receiver?.kind === 'flags' &&
    (method === 'isFeatureEnabled' || method === 'getFeatureValue')
  ) {
    return { method, product: 'node', where, parameter };
  }
  return undefined;
}

/** The wrappers among an object literal's methods, by property name. */
export function objectWrappers(
  object: NodePath,
  classifier: Classifier,
  file: string,
  line: (offset: number) => number,
): Map<string, Wrapper> {
  const wrappers = new Map<string, Wrapper>();
  if (!object.isObjectExpression()) {
    return wrappers;
  }
  for (const property of object.get('properties')) {
    if (!property.isObjectMethod() && !property.isObjectProperty()) {
      continue;
    }
    const key = propertyKey(property.node.key, property.node.computed);
    const fn = property.isObjectMethod() ? property : (property.get('value') as NodePath);
    const wrapper = key === undefined ? undefined : wrapperOf(fn, classifier, file, line);
    if (key !== undefined && wrapper !== undefined) {
      wrappers.set(key, wrapper);
    }
  }
  return wrappers;
}

/** The function or object a same-file binding holds, for wrappers defined in the calling file. */
export function localWrapper(
  callee: NodePath,
  classifier: Classifier,
  file: string,
  line: (offset: number) => number,
): Wrapper | undefined {
  const object = callee.isMemberExpression() ? (callee.get('object') as NodePath) : callee;
  if (!object.isIdentifier()) {
    return undefined;
  }
  const binding = object.scope.getBinding(object.node.name);
  if (binding === undefined || !binding.constant) {
    return undefined;
  }
  const declaration = binding.path;
  const init = declaration.isVariableDeclarator() ? declaration.get('init') : undefined;
  const value: NodePath | undefined =
    init === undefined ? declaration : init.hasNode() ? init : undefined;
  if (value === undefined) {
    return undefined;
  }
  if (callee.isMemberExpression()) {
    const method = memberName(callee);
    return method === undefined
      ? undefined
      : objectWrappers(value, classifier, file, line).get(method);
  }
  return wrapperOf(value, classifier, file, line);
}

/** The rule a wrapper's read stands for, for evidence: W1 over C1, C2, N1 or N2. */
export function wrappedRule(wrapper: Wrapper): string {
  const reads: Record<string, string> = { ...clientReads, ...nodeFlagsReads };
  return reads[wrapper.method] ?? wrapper.method;
}

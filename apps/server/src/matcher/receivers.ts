import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { importOf, propertyKey } from './names.js';
import {
  clientFactory,
  clientGlobal,
  clientGlobals,
  nodeClientClass,
  nodeFlagsFetches,
  reactHooks,
  sdkModule,
  type ReactHook,
} from './sdk-modules.js';

/**
 * Receiver tracing (architecture.md 8.3): what an expression refers to, when it is a Flagsmith
 * SDK object. Each result says how it was traced, for the record's evidence.
 */
export type Traced =
  | { kind: 'client'; via: string }
  | { kind: 'factory'; via: string }
  | { kind: 'hook'; hook: ReactHook; via: string }
  | { kind: 'node-class'; via: string }
  | { kind: 'node-client'; via: string }
  | { kind: 'flags-promise'; via: string }
  | { kind: 'flags'; via: string };

/** An SDK object another module of the repository exports, found by the repository pass. */
export type ExportedSdk = {
  lookupSdk(fromFile: string, specifier: string, exported: string): Traced | undefined;
};

function classifyModuleExport(
  source: string,
  imported: string,
  file: string,
  exports: ExportedSdk,
): Traced | undefined {
  const product = sdkModule(source);
  if (product === 'client') {
    if (imported === 'default') {
      return { kind: 'client', via: `the default import of '${source}'` };
    }
    return imported === clientFactory
      ? { kind: 'factory', via: `${clientFactory}() from '${source}'` }
      : undefined;
  }
  if (product === 'react') {
    const hook = reactHooks.find((name) => name === imported);
    return hook === undefined
      ? undefined
      : { kind: 'hook', hook, via: `${hook}() from '${source}'` };
  }
  if (product === 'node') {
    return imported === nodeClientClass || imported === 'default'
      ? { kind: 'node-class', via: `${nodeClientClass} from '${source}'` }
      : undefined;
  }
  return product === 'types' ? undefined : exports.lookupSdk(file, source, imported);
}

/** `require('x')` with a literal, when `require` is the CommonJS global. */
export function requireSource(path: NodePath): string | undefined {
  const node = path.node;
  if (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee, { name: 'require' }) &&
    path.scope.getBinding('require') === undefined
  ) {
    const [argument] = node.arguments;
    return t.isStringLiteral(argument) ? argument.value : undefined;
  }
  return undefined;
}

function unwrapTs(path: NodePath): NodePath {
  let current = path;
  while (
    current.isTSAsExpression() ||
    current.isTSNonNullExpression() ||
    current.isTSSatisfiesExpression() ||
    current.isTSTypeAssertion()
  ) {
    current = current.get('expression') as NodePath;
  }
  return current;
}

export function memberName(path: NodePath): string | undefined {
  if (path.isMemberExpression() || path.isOptionalMemberExpression()) {
    return propertyKey(path.node.property, path.node.computed);
  }
  return undefined;
}

/**
 * Traces expressions of one file. `clientExpressions` are the `clients` entries of `flagops.json`
 * (survey 4.3), matched on the expression's source text, such as `$flags`.
 */
export class Classifier {
  readonly #memo = new Map<t.Node, Traced | undefined>();

  constructor(
    private readonly file: string,
    private readonly text: string,
    private readonly exports: ExportedSdk,
    private readonly clientExpressions: ReadonlySet<string>,
  ) {}

  /** The source text of an expression, for evidence and for the configured client expressions. */
  sourceText(path: NodePath): string {
    return this.text.slice(path.node.start ?? 0, path.node.end ?? 0);
  }

  classify(path: NodePath): Traced | undefined {
    const inner = unwrapTs(path);
    if (this.#memo.has(inner.node)) {
      return this.#memo.get(inner.node);
    }
    this.#memo.set(inner.node, undefined);
    const result = this.#compute(inner);
    this.#memo.set(inner.node, result);
    return result;
  }

  #compute(path: NodePath): Traced | undefined {
    const source = this.sourceText(path);
    if (this.clientExpressions.has(source)) {
      return { kind: 'client', via: `${source}, a client declared in flagops.json` };
    }
    if (path.isIdentifier()) {
      return this.#identifier(path);
    }
    if (path.isAwaitExpression()) {
      const inner = this.classify(path.get('argument'));
      return inner?.kind === 'flags-promise' ? { kind: 'flags', via: inner.via } : undefined;
    }
    if (path.isNewExpression()) {
      const callee = this.classify(path.get('callee'));
      return callee?.kind === 'node-class'
        ? { kind: 'node-client', via: `new ${callee.via}` }
        : undefined;
    }
    if (path.isMemberExpression() || path.isOptionalMemberExpression()) {
      return this.#member(path);
    }
    if (path.isCallExpression() || path.isOptionalCallExpression()) {
      return this.#call(path);
    }
    return undefined;
  }

  #identifier(path: NodePath<t.Identifier>): Traced | undefined {
    const name = path.node.name;
    const binding = path.scope.getBinding(name);
    if (binding === undefined) {
      // The browser builds assign the client to a global.
      return name === clientGlobal
        ? { kind: 'client', via: `the global ${clientGlobal}` }
        : undefined;
    }
    const imported = importOf(path, name);
    if (imported !== undefined) {
      return classifyModuleExport(imported.source, imported.imported, this.file, this.exports);
    }
    if (!binding.constant) {
      return undefined;
    }
    if (binding.path.isVariableDeclarator()) {
      return this.#declarator(binding.path, name);
    }
    return binding.kind === 'param' ? this.#thenParameter(binding.path, name) : undefined;
  }

  #declarator(declarator: NodePath<t.VariableDeclarator>, name: string): Traced | undefined {
    const init = declarator.get('init');
    if (!init.hasNode()) {
      return undefined;
    }
    const id = declarator.node.id;
    if (t.isIdentifier(id)) {
      return this.classify(init);
    }
    // const { Flagsmith } = require('@flagsmith/nodejs'), const { default: client } = require(...)
    const required = requireSource(init);
    if (t.isObjectPattern(id) && required !== undefined) {
      for (const property of id.properties) {
        if (t.isObjectProperty(property) && t.isIdentifier(property.value, { name })) {
          const key = propertyKey(property.key, property.computed);
          if (key !== undefined) {
            return classifyModuleExport(required, key, this.file, this.exports);
          }
        }
      }
    }
    return undefined;
  }

  /** `client.getEnvironmentFlags().then((flags) => ...)`: the callback's first parameter. */
  #thenParameter(parameter: NodePath, name: string): Traced | undefined {
    const fn = parameter.isFunction() ? parameter : parameter.getFunctionParent();
    if (fn === null || !t.isIdentifier(fn.node.params[0], { name })) {
      return undefined;
    }
    const call = fn.parentPath;
    if (!call.isCallExpression() || call.node.arguments[0] !== fn.node) {
      return undefined;
    }
    const callee = call.get('callee');
    if (memberName(callee) !== 'then') {
      return undefined;
    }
    const promise = this.classify(callee.get('object'));
    return promise?.kind === 'flags-promise' ? { kind: 'flags', via: promise.via } : undefined;
  }

  #member(path: NodePath<t.MemberExpression | t.OptionalMemberExpression>): Traced | undefined {
    const name = memberName(path);
    const object = path.get('object') as NodePath;
    if (name === undefined) {
      return undefined;
    }
    if (
      name === clientGlobal &&
      object.isIdentifier() &&
      (clientGlobals as readonly string[]).includes(object.node.name) &&
      object.scope.getBinding(object.node.name) === undefined
    ) {
      return { kind: 'client', via: `${object.node.name}.flagsmith` };
    }
    if (object.isIdentifier()) {
      const binding = object.scope.getBinding(object.node.name);
      if (binding?.path.isImportNamespaceSpecifier() === true) {
        const declaration = binding.path.parentPath.node as t.ImportDeclaration;
        return classifyModuleExport(declaration.source.value, name, this.file, this.exports);
      }
      const required =
        binding?.path.isVariableDeclarator() === true
          ? requireSource(binding.path.get('init') as NodePath)
          : undefined;
      if (required !== undefined) {
        return classifyModuleExport(required, name, this.file, this.exports);
      }
    }
    const required = requireSource(object);
    return required === undefined
      ? undefined
      : classifyModuleExport(required, name, this.file, this.exports);
  }

  #call(path: NodePath<t.CallExpression | t.OptionalCallExpression>): Traced | undefined {
    const callee = path.get('callee') as NodePath;
    const name = memberName(callee);
    if (name === undefined) {
      const traced = this.classify(callee);
      if (traced?.kind === 'factory') {
        return { kind: 'client', via: traced.via };
      }
      return traced?.kind === 'hook' && traced.hook === 'useFlagsmith'
        ? { kind: 'client', via: traced.via }
        : undefined;
    }
    const receiver = this.classify(callee.get('object'));
    if (
      receiver?.kind === 'node-client' &&
      (nodeFlagsFetches as readonly string[]).includes(name)
    ) {
      return { kind: 'flags-promise', via: `${name}() on ${receiver.via}` };
    }
    return undefined;
  }
}

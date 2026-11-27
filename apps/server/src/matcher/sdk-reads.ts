import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { importOf, literalOf } from './names.js';
import type { RepositoryIndex } from './repo-pass.js';
import { memberName, type Classifier } from './receivers.js';
import {
  clientReads,
  nodeClientReads,
  nodeFlagsReads,
  untracedClientMethods,
  untracedHooks,
  type Product,
} from './sdk-modules.js';
import { localWrapper, wrappedRule, type Wrapper } from './wrappers.js';

/**
 * The call shapes of architecture.md 8.3: whether a call reads a flag, by which rule, and where
 * its flag-name arguments are. The scanner turns sites into records; accessor validation uses
 * them to check that an accessor's body reads the SDK.
 */
export type ReadSite =
  | {
      kind: 'read';
      rule: string;
      method: string;
      product: Product;
      traced: boolean;
      via: string;
      /** The flag-name arguments: one, or each element of a `useFlags` list. */
      names: NodePath[];
      /**
       * The name-list argument of a list-shaped read, `useFlags` or a flags-object accessor;
       * undefined for reads of one name.
       */
      list: NodePath | undefined;
      /** A list that is not a literal array or string. */
      listIsDynamic: boolean;
    }
  | { kind: 'unattributed'; method: string; via: string; argument: NodePath | undefined };

export type Call = NodePath<t.CallExpression | t.OptionalCallExpression>;

/** A configured accessor's call, as `flagops.json` describes it (accessors.ts). */
export type AccessorCall = {
  rule: string;
  method: string;
  product: Product;
  via: string;
  names: NodePath[];
  list: NodePath | undefined;
  listIsDynamic: boolean;
};

export type ReadContext = {
  file: string;
  classifier: Classifier;
  products: ReadonlySet<Product>;
  index: RepositoryIndex;
  line: (offset: number) => number;
  accessorCall: (call: Call) => AccessorCall | undefined;
};

function argumentsOf(call: Call): NodePath[] {
  return call.get('arguments');
}

/** The names a `useFlags`-shaped list holds: a literal array's elements, or one string. */
export function nameList(list: NodePath | undefined): { names: NodePath[]; dynamic: boolean } {
  if (list === undefined) {
    return { names: [], dynamic: true };
  }
  if (list.isArrayExpression()) {
    const elements = list.get('elements');
    // Holes and spreads hide names, so the list counts as dynamic.
    const present = elements.filter(
      (element): element is NodePath<t.Expression> =>
        element.hasNode() && !element.isSpreadElement(),
    );
    return { names: present, dynamic: present.length !== elements.length };
  }
  return literalOf(list.node, '') === undefined
    ? { names: [], dynamic: true }
    : { names: [list], dynamic: false };
}

function read(
  rule: string,
  method: string,
  product: Product,
  via: string,
  names: NodePath[],
  traced = true,
): Extract<ReadSite, { kind: 'read' }> {
  return {
    kind: 'read',
    rule,
    method,
    product,
    traced,
    via,
    names,
    list: undefined,
    listIsDynamic: false,
  };
}

/** An imported or same-file pass-through wrapper (W1). */
function wrapperOfCallee(callee: NodePath, context: ReadContext): Wrapper | undefined {
  const local = localWrapper(callee, context.classifier, context.file, context.line);
  if (local !== undefined) {
    return local;
  }
  const object = callee.isMemberExpression() ? (callee.get('object') as NodePath) : callee;
  if (!object.isIdentifier()) {
    return undefined;
  }
  const imported = importOf(object, object.node.name);
  if (imported !== undefined) {
    const method = callee.isMemberExpression() ? memberName(callee) : undefined;
    const exported = method === undefined ? imported.imported : `${imported.imported}.${method}`;
    return context.index.lookupWrapper(context.file, imported.source, exported);
  }
  const binding = object.scope.getBinding(object.node.name);
  if (binding?.path.isImportNamespaceSpecifier() === true && callee.isMemberExpression()) {
    const source = (binding.path.parentPath.node as t.ImportDeclaration).source.value;
    const method = memberName(callee);
    return method === undefined
      ? undefined
      : context.index.lookupWrapper(context.file, source, method);
  }
  return undefined;
}

function memberCall(
  call: Call,
  callee: NodePath<t.MemberExpression | t.OptionalMemberExpression>,
  method: string,
  context: ReadContext,
): ReadSite | undefined {
  const receiver = context.classifier.classify(callee.get('object'));
  const [first] = argumentsOf(call);
  const names = first === undefined ? [] : [first];
  if (receiver?.kind === 'client' && method in clientReads) {
    return read(
      clientReads[method as keyof typeof clientReads],
      method,
      'client',
      receiver.via,
      names,
    );
  }
  if (receiver?.kind === 'flags' && method in nodeFlagsReads) {
    return read(
      nodeFlagsReads[method as keyof typeof nodeFlagsReads],
      method,
      'node',
      receiver.via,
      names,
    );
  }
  if (receiver?.kind === 'node-client' && method in nodeClientReads) {
    return read(
      nodeClientReads[method as keyof typeof nodeClientReads],
      method,
      'node',
      receiver.via,
      names,
    );
  }
  if (receiver !== undefined) {
    return undefined;
  }
  return untracedMemberCall(call, callee, method, names, context);
}

function untracedMemberCall(
  call: Call,
  callee: NodePath<t.MemberExpression | t.OptionalMemberExpression>,
  method: string,
  names: NodePath[],
  context: ReadContext,
): ReadSite | undefined {
  const accessor = context.accessorCall(call);
  if (accessor !== undefined) {
    return { kind: 'read', traced: true, ...accessor };
  }
  const wrapper = wrapperOfCallee(callee, context);
  if (wrapper !== undefined) {
    return read(
      'W1',
      method,
      wrapper.product,
      `a wrapper of ${wrappedRule(wrapper)} at ${wrapper.where}`,
      names,
    );
  }
  const receiverText = context.classifier.sourceText(callee.get('object'));
  if (context.products.has('node') && method in nodeFlagsReads) {
    const rule = nodeFlagsReads[method as keyof typeof nodeFlagsReads];
    const via = `${receiverText}, matched by its method name in a package that uses the Node SDK`;
    return read(rule, method, 'node', via, names, false);
  }
  const usesClient = context.products.has('client') || context.products.has('react');
  if (usesClient && untracedClientMethods.has(method)) {
    return {
      kind: 'unattributed',
      method,
      via: `${receiverText}, which is not traced to the SDK`,
      argument: names[0],
    };
  }
  return undefined;
}

function hookCall(
  call: Call,
  callee: NodePath<t.Identifier>,
  context: ReadContext,
): ReadSite | undefined {
  const traced = context.classifier.classify(callee);
  const args = argumentsOf(call);
  if (traced?.kind === 'hook' && traced.hook === 'useFlags') {
    const list = nameList(args[0]);
    const parent = call.parentPath;
    const destructured = parent.isVariableDeclarator() && t.isObjectPattern(parent.node.id);
    const site = read(destructured ? 'R1' : 'R2', 'useFlags', 'react', traced.via, list.names);
    return { ...site, list: args[0], listIsDynamic: list.dynamic };
  }
  if (traced?.kind === 'hook' && traced.hook === 'useExperiment') {
    return read('R3', 'useExperiment', 'react', traced.via, args[0] === undefined ? [] : [args[0]]);
  }
  if (traced !== undefined) {
    return undefined;
  }
  const accessor = context.accessorCall(call);
  if (accessor !== undefined) {
    return { kind: 'read', traced: true, ...accessor };
  }
  const wrapper = wrapperOfCallee(callee, context);
  if (wrapper !== undefined) {
    const via = `a wrapper of ${wrappedRule(wrapper)} at ${wrapper.where}`;
    return read(
      'W1',
      callee.node.name,
      wrapper.product,
      via,
      args[0] === undefined ? [] : [args[0]],
    );
  }
  const usesClient = context.products.has('client') || context.products.has('react');
  return usesClient && untracedHooks.has(callee.node.name)
    ? {
        kind: 'unattributed',
        method: callee.node.name,
        via: `${callee.node.name}(), which is not imported from the SDK`,
        argument: args[0],
      }
    : undefined;
}

/** The read a call makes, or undefined when it is not a flag read. */
export function readSiteOf(call: Call, context: ReadContext): ReadSite | undefined {
  const callee = call.get('callee') as NodePath;
  if (callee.isMemberExpression() || callee.isOptionalMemberExpression()) {
    const method = memberName(callee);
    return method === undefined ? undefined : memberCall(call, callee, method, context);
  }
  if (callee.isIdentifier()) {
    return hookCall(call, callee, context);
  }
  const accessor = context.accessorCall(call);
  return accessor === undefined ? undefined : { kind: 'read', traced: true, ...accessor };
}

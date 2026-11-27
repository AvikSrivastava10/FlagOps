import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { literalOf, resolveStaticName, type ExportedStrings, type Origin } from './names.js';
import { traverse } from './parse.js';
import type { CodeRecord, SourceLines } from './records.js';
import type { NameResolver } from './resolve-name.js';
import { readSiteOf, type Call, type ReadContext, type ReadSite } from './sdk-reads.js';
import { wrapperOf } from './wrappers.js';

/**
 * The SDK reads of one file as records (architecture.md 8.3). In a test-like file only matched
 * reads of a known flag are kept, as `test_reference`: tests are never rewritten and count for
 * nothing (D-060), so their zombies and suspects are not recorded either.
 */
export type FileContext = ReadContext & {
  text: string;
  lines: SourceLines;
  isTest: boolean;
  resolveName: NameResolver;
  exported: ExportedStrings;
  /** The name parameters of validated accessors, whose own reads are not dynamic (D-063). */
  accessorParameters: ReadonlySet<t.Identifier>;
};

export type FileMatch = {
  records: CodeRecord[];
  /** Literals that hold a matched name, so the mention pass skips them. */
  consumed: Origin[];
  /**
   * Offsets of the keys destructured from `useFlags` or a flags-object accessor, which are use
   * sites, not mentions.
   */
  patternKeys: Set<number>;
};

type Draft = Omit<CodeRecord, 'filePath' | 'line' | 'column' | 'snippet' | 'evidence'> & {
  at: number;
  evidence: string;
};

/**
 * A declared function: a function declaration, a `const`'s value, or an object's method. Inline
 * callbacks, such as the one passed to `names.map(...)`, are not wrappers.
 */
function isDeclaredFunction(fn: NodePath): boolean {
  const parent = fn.parentPath;
  return (
    fn.isFunctionDeclaration() ||
    fn.isObjectMethod() ||
    parent?.isVariableDeclarator() === true ||
    (parent?.isObjectProperty() === true && parent.node.value === fn.node)
  );
}

/** A name argument that is the parameter of a validated accessor or of a W1 wrapper. */
function isOwnParameter(name: NodePath, context: FileContext): boolean {
  if (!name.isIdentifier()) {
    return false;
  }
  const binding = name.scope.getBinding(name.node.name);
  if (binding?.kind !== 'param') {
    return false;
  }
  if (context.accessorParameters.has(binding.identifier)) {
    return true;
  }
  const fn = binding.path.isFunction() ? binding.path : binding.path.getFunctionParent();
  if (fn === null || !isDeclaredFunction(fn)) {
    return false;
  }
  return (
    wrapperOf(fn, context.classifier, context.file, context.line)?.parameter === binding.identifier
  );
}

function draftsOf(call: Call, site: ReadSite, context: FileContext, match: FileMatch): Draft[] {
  if (site.kind === 'unattributed') {
    if (context.isTest) {
      return [];
    }
    const literal = literalOf(site.argument?.node, context.file)?.value ?? null;
    return [
      {
        kind: 'unattributed',
        flagName: null,
        literal,
        product: null,
        ruleId: 'unattributed',
        method: site.method,
        traced: false,
        suggestion: null,
        at: site.argument?.node.start ?? call.node.start ?? 0,
        evidence: `${site.method}() on ${site.via}`,
      },
    ];
  }
  const base = {
    product: site.product,
    ruleId: site.rule,
    method: site.method,
    traced: site.traced,
  };
  const drafts: Draft[] = [];
  const dynamic = (at: number, what: string): void => {
    if (!context.isTest) {
      drafts.push({
        ...base,
        kind: 'dynamic',
        flagName: null,
        literal: null,
        suggestion: null,
        at,
        evidence: `${site.rule}: ${what} on ${site.via}`,
      });
    }
  };
  // A flags-object accessor hands its own list parameter to `useFlags`; its call sites carry the names.
  const ownList = site.list !== undefined && isOwnParameter(site.list, context);
  if (site.listIsDynamic && !ownList) {
    dynamic(call.node.start ?? 0, `${site.method}() with a name list that is not a literal`);
  }
  for (const name of site.names) {
    if (isOwnParameter(name, context)) {
      continue;
    }
    const at = name.node.start ?? 0;
    const resolved = resolveStaticName(name, context.file, context.exported);
    if (resolved.kind === 'dynamic') {
      dynamic(
        at,
        `${site.method}() with the name ${context.classifier.sourceText(name)}, computed at runtime`,
      );
      continue;
    }
    const resolution = context.resolveName(site.product, resolved.value);
    const evidence = `${site.rule}: ${site.method}() on ${site.via}`;
    if (resolution.kind === 'flag') {
      // Only a name that reads a flag leaves the mention pass. An ambiguous or unknown name keeps
      // its literal there, so every flag it could stand for stays guarded (D-044).
      match.consumed.push(resolved.origin, { file: context.file, start: at });
      drafts.push({
        ...base,
        kind: context.isTest ? 'test_reference' : 'reference',
        flagName: resolution.flag,
        literal: resolved.value,
        suggestion: null,
        at,
        evidence,
      });
    } else if (context.isTest) {
      continue;
    } else if (resolution.kind === 'ambiguous') {
      drafts.push({
        ...base,
        kind: 'ambiguous_name',
        flagName: null,
        literal: resolved.value,
        suggestion: null,
        at,
        evidence: `${evidence}; the name could be any of ${resolution.flags.join(', ')}`,
      });
    } else {
      drafts.push({
        ...base,
        kind: 'unresolved_name',
        flagName: null,
        literal: resolved.value,
        suggestion: resolution.suggestion,
        at,
        evidence: `${evidence}; Flagsmith has no flag with this name`,
      });
    }
  }
  return drafts;
}

/**
 * The keys of `const { a, b: alias } = useFlags([...])` (R1), or of the same pattern on a
 * flags-object accessor's result: use sites, not mentions.
 */
function collectPatternKeys(call: Call, site: ReadSite, match: FileMatch): void {
  if (site.kind !== 'read' || site.list === undefined) {
    return;
  }
  const declarator = call.parentPath.node;
  if (t.isVariableDeclarator(declarator) && t.isObjectPattern(declarator.id)) {
    for (const property of declarator.id.properties) {
      if (
        t.isObjectProperty(property) &&
        property.key.start !== null &&
        property.key.start !== undefined
      ) {
        match.patternKeys.add(property.key.start);
      }
    }
  }
}

export function matchFile(ast: t.File, context: FileContext): FileMatch {
  const match: FileMatch = { records: [], consumed: [], patternKeys: new Set() };
  traverse(ast, {
    'CallExpression|OptionalCallExpression'(path: NodePath) {
      const call = path as Call;
      const site = readSiteOf(call, context);
      if (site === undefined) {
        return;
      }
      collectPatternKeys(call, site, match);
      for (const draft of draftsOf(call, site, context, match)) {
        const { at, ...record } = draft;
        const position = context.lines.position(at);
        match.records.push({
          ...record,
          filePath: context.file,
          line: position.line,
          column: position.column,
          snippet: context.lines.snippet(position.line),
        });
      }
    },
  });
  return match;
}

/**
 * Finds segment conditions where the Node engine can still disagree with the Python engine that
 * Flagsmith's server runs, after the server profile's normalisations (architecture.md 10.1 and
 * 10.4), and the flags those conditions reach, also through `$.flags`. A preview labels these
 * flags "approximate" with the cause instead of presenting their numbers as exact.
 *
 * The codes R2 to R13 are those of the impact-preview spike report, section 4. R15 (MODULO
 * arithmetic) and R16 (condition properties) were found later, each by running the condition
 * through both engines. Where a check cannot tell, it warns.
 */
import {
  anchorLikePythonMatch,
  coerceTraitValue,
  flagsReadBy,
  inValuesLikePython,
  pythonNumberKind,
} from './server-profile.js';
import type {
  EnvironmentDocument,
  IdentityTrait,
  PreviewIdentity,
  SegmentConditionDoc,
  SegmentRuleDoc,
} from './types.js';

export type DivergenceCode =
  'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R10' | 'R13' | 'R15' | 'R16';

export type DivergenceCause = { code: DivergenceCode; description: string };

export type DivergenceWarning = {
  segmentId: number;
  segmentName: string;
  condition: SegmentConditionDoc;
  cause: DivergenceCause;
  /** The flags the segment overrides in any of the linted documents, sorted. */
  flags: string[];
};

export type DivergenceLint = {
  warnings: DivergenceWarning[];
  /** Flag name -> why its preview may differ from Flagsmith's, for every such flag, by name. */
  approximate: Record<string, DivergenceCause[]>;
};

/**
 * What the identities' values of one trait look like to the two engines, after the server
 * profile's conversion of numeric-looking strings:
 * - the Python type, where `whole-float` is a float with a whole value such as 3.0, which
 *   JavaScript cannot tell from an integer (R13);
 * - `zero-or-empty`: an integer 0 or an empty string, which Node treats as missing in IN and in
 *   percentage splits;
 * - `negative`: a number below 0;
 * - `number-prefixed-text`: text such as "3px" that JavaScript's parseFloat() reads as a number;
 * - `exponent-float`: a float that Python's str() writes with an exponent and JavaScript without,
 *   or differently (Python switches below 1e-4 and from 1e16, JavaScript below 1e-6 and from 1e21).
 */
type Observed =
  | 'integer'
  | 'float'
  | 'whole-float'
  | 'boolean'
  | 'string'
  | 'null'
  | 'zero-or-empty'
  | 'negative'
  | 'number-prefixed-text'
  | 'exponent-float';

const cause = {
  regexSyntax: { code: 'R2', description: 'REGEX pattern that JavaScript rejects' },
  regexOnBoolean: { code: 'R3', description: 'REGEX on a boolean trait' },
  regexOnExponentFloat: {
    code: 'R3',
    description: 'REGEX on a float that Python and JavaScript write differently',
  },
  splitOnBoolean: { code: 'R3', description: 'percentage split on a boolean trait' },
  splitOnExponentFloat: {
    code: 'R3',
    description: 'percentage split on a float that Python and JavaScript write differently',
  },
  numericContextValue: {
    code: 'R4',
    description: 'condition on a context value that Python reads as a number',
  },
  integerComparedWithNonInteger: {
    code: 'R5',
    description: 'integer trait compared with a value that is not an integer',
  },
  floatComparedWithNonNumber: {
    code: 'R5',
    description: 'float trait compared with a value that is not a number',
  },
  moduloValue: {
    code: 'R5',
    description: 'MODULO value that Python and JavaScript may read as different numbers',
  },
  splitValue: {
    code: 'R5',
    description: 'percentage split value that Python and JavaScript may read as different numbers',
  },
  inOnFloat: { code: 'R6', description: 'IN on a float trait' },
  inOnZeroOrEmpty: { code: 'R6', description: 'IN on a trait that is 0 or ""' },
  inWithJsonList: {
    code: 'R6',
    description: 'IN with a JSON list of floats, booleans, nulls or large integers',
  },
  moduloOnBoolean: { code: 'R7', description: 'MODULO on a boolean trait' },
  moduloOnText: { code: 'R7', description: 'MODULO on a text trait that starts with a number' },
  splitOnTraitName: { code: 'R8', description: 'percentage split on a plain trait name' },
  splitOnZeroOrEmpty: {
    code: 'R8',
    description: 'percentage split on a trait that is 0 or "", which Node treats as missing',
  },
  wholeFloat: {
    code: 'R13',
    description: 'float trait with whole values, such as 3.0, which JavaScript reads as integers',
  },
  moduloNegative: {
    code: 'R15',
    description: 'MODULO with a negative number, where Python and JavaScript differ in sign',
  },
  moduloByZero: {
    code: 'R15',
    description: "MODULO by zero, which fails Flagsmith's evaluation of identities with a number",
  },
  isNotSetWithoutProperty: {
    code: 'R16',
    description: 'IS_NOT_SET without a property, which Python matches for everyone and Node never',
  },
  unverifiedPath: {
    code: 'R16',
    description: 'JSONPath property that the two engines may resolve differently',
  },
} as const satisfies Record<string, DivergenceCause>;

const COMPARISONS = new Set([
  'EQUAL',
  'NOT_EQUAL',
  'GREATER_THAN',
  'GREATER_THAN_INCLUSIVE',
  'LESS_THAN',
  'LESS_THAN_INCLUSIVE',
]);
// Numbers that Python's int() and float() and JavaScript's parseFloat() read alike.
const INTEGER_LITERAL = /^\s*[+-]?\d+\s*$/;
const DECIMAL_LITERAL = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const NUMERIC_TYPES: readonly Observed[] = ['integer', 'float', 'whole-float', 'boolean'];

/** Context values that both engines resolve alike, in the parity suite and the probes. */
const VERIFIED_CONTEXT_PATHS = new Set([
  '$.identity.identifier',
  '$.identity.key',
  '$.environment.name',
  '$.environment.key',
]);
// Trait names that Python's jsonpath-rfc9535 and Node's direct lookup read alike after a dot,
// as probed: letters, digits, "_" and "-", not starting with a digit.
const TRAIT_NAME = /^[A-Za-z_][\w-]*$/;
const TRAIT_DOT_PATH = /^\$\.identity\.traits\.(.+)$/;
const TRAIT_BRACKET_PATH = /^\$\.identity\.traits\[(?:'([^'\\\p{Cc}]+)'|"([^"\\\p{Cc}]+)")\]$/u;
// The shape Flagsmith writes for a flag dependency, which the spike's fixtures cover.
const DEPENDENCY_PATH = /^\$\.flags\["(?:[^"\\]|\\.)+"\]\.enabled$/;

/**
 * Lints the segments of the given documents, typically the target's document before and after a
 * change, against the traits of the identities the preview evaluates.
 */
export function lintDivergences(
  documents: readonly EnvironmentDocument[],
  identities: readonly PreviewIdentity[],
): DivergenceLint {
  const segments = segmentsById(documents);
  const traitTypes = observedTraitTypes(identities);
  const numericContextValues = new Set<string>();
  if (identities.some((identity) => pythonNumberKind(identity.identifier) !== undefined)) {
    numericContextValues.add('$.identity.identifier');
  }
  for (const document of documents) {
    if (!document.use_identity_composite_key_for_hashing) {
      // The key is then `Identity.id`.
      numericContextValues.add('$.identity.key');
    }
    if (pythonNumberKind(document.name ?? '') !== undefined) {
      numericContextValues.add('$.environment.name');
    }
    if (pythonNumberKind(document.api_key) !== undefined) {
      numericContextValues.add('$.environment.key');
    }
  }

  const warnings: DivergenceWarning[] = [];
  for (const segment of segments) {
    for (const condition of conditionsOf(segment.rules)) {
      const property = condition.property_ ?? '';
      const trait = traitName(property);
      const types = (trait === undefined ? undefined : traitTypes.get(trait)) ?? noTypes;
      for (const found of causesFor(condition, types, numericContextValues.has(property))) {
        warnings.push({
          segmentId: segment.id,
          segmentName: segment.name,
          condition,
          cause: found,
          flags: [...segment.flags].sort(),
        });
      }
    }
  }
  return { warnings, approximate: approximateFlags(segments, warnings) };
}

const noTypes: ReadonlySet<Observed> = new Set();

type LintedSegment = { id: number; name: string; rules: SegmentRuleDoc[]; flags: Set<string> };

/** Each segment once, with the flags it overrides in any document. Unused segments are skipped. */
function segmentsById(documents: readonly EnvironmentDocument[]): LintedSegment[] {
  const segments = new Map<number, LintedSegment>();
  for (const segment of documents.flatMap((document) => document.project.segments)) {
    const linted = segments.get(segment.id) ?? {
      id: segment.id,
      name: segment.name,
      rules: segment.rules,
      flags: new Set<string>(),
    };
    for (const state of segment.feature_states) {
      linted.flags.add(state.feature.name);
    }
    segments.set(segment.id, linted);
  }
  return [...segments.values()].filter((segment) => segment.flags.size > 0);
}

function causesFor(
  condition: SegmentConditionDoc,
  types: ReadonlySet<Observed>,
  readsNumericContextValue: boolean,
): DivergenceCause[] {
  const value = condition.value ?? '';
  const property = condition.property_ ?? '';
  const causes: DivergenceCause[] = [];
  if (property === '') {
    // Node matches nothing without a property; Python reads the trait named "", which is never
    // set. Both use the identity key for a percentage split.
    if (condition.operator === 'IS_NOT_SET') {
      causes.push(cause.isNotSetWithoutProperty);
    }
  } else if (property.startsWith('$.') && !isVerifiedPath(property)) {
    causes.push(cause.unverifiedPath);
  }
  if (
    readsNumericContextValue &&
    condition.operator !== 'IS_SET' &&
    condition.operator !== 'IS_NOT_SET'
  ) {
    // FlagOps converts trait values only (R4), so other context values reach Node as strings.
    causes.push(cause.numericContextValue);
  }
  switch (condition.operator) {
    case 'REGEX':
      // Python matches against str() of the value, Node against its JavaScript string.
      if (!compiles(anchorLikePythonMatch(value))) {
        causes.push(cause.regexSyntax);
      }
      if (types.has('boolean')) {
        causes.push(cause.regexOnBoolean);
      }
      if (types.has('exponent-float')) {
        causes.push(cause.regexOnExponentFloat);
      }
      if (types.has('whole-float')) {
        causes.push(cause.wholeFloat);
      }
      break;
    case 'IN':
      // Python matches only text and integers, Node any value but a boolean or a falsy one.
      if (types.has('float')) {
        causes.push(cause.inOnFloat);
      }
      if (types.has('whole-float')) {
        causes.push(cause.wholeFloat);
      }
      if (types.has('zero-or-empty')) {
        causes.push(cause.inOnZeroOrEmpty);
      }
      if (value.startsWith('[') && typeof inValuesLikePython(value) === 'string') {
        causes.push(cause.inWithJsonList);
      }
      break;
    case 'MODULO':
      causes.push(...moduloCauses(value, types));
      break;
    case 'PERCENTAGE_SPLIT':
      causes.push(...splitCauses(value, property, types));
      break;
    default:
      // Python casts the condition value with int() or float() and fails closed, NOT_EQUAL
      // included; Node uses parseFloat().
      if (COMPARISONS.has(condition.operator) && !value.endsWith(':semver')) {
        if (types.has('integer') && !INTEGER_LITERAL.test(value)) {
          causes.push(cause.integerComparedWithNonInteger);
        } else if (
          (types.has('float') || types.has('whole-float')) &&
          !DECIMAL_LITERAL.test(value)
        ) {
          causes.push(cause.floatComparedWithNonNumber);
        }
      }
  }
  return causes;
}

/**
 * `_evaluate_modulo` (flag_engine/segments/evaluator.py) against Node's `evaluateModulo`: Python
 * matches only numbers, booleans included, reads both parts with float(), takes the divisor's
 * sign and raises on a zero divisor. Node reads the trait and both parts with parseFloat(), takes
 * the trait's sign, and matches nothing for a zero divisor.
 */
function moduloCauses(value: string, types: ReadonlySet<Observed>): DivergenceCause[] {
  const causes: DivergenceCause[] = [];
  if (types.has('boolean')) {
    causes.push(cause.moduloOnBoolean);
  }
  if (types.has('number-prefixed-text')) {
    causes.push(cause.moduloOnText);
  }
  const parts = value.split('|');
  if (parts.length !== 2) {
    // Neither engine matches.
    return causes;
  }
  if (!parts.every((part) => DECIMAL_LITERAL.test(part))) {
    causes.push(cause.moduloValue);
    return causes;
  }
  const divisor = Number(parts[0]);
  if (divisor === 0) {
    if (NUMERIC_TYPES.some((type) => types.has(type))) {
      causes.push(cause.moduloByZero);
    }
  } else if (divisor < 0 || types.has('negative')) {
    causes.push(cause.moduloNegative);
  }
  return causes;
}

/**
 * Python hashes `str()` of any value but None and reads the split with float(). Node reads only
 * `$.` properties, treats every falsy value as missing, and reads the split with parseFloat().
 */
function splitCauses(
  value: string,
  property: string,
  types: ReadonlySet<Observed>,
): DivergenceCause[] {
  const causes: DivergenceCause[] = [];
  if (!DECIMAL_LITERAL.test(value)) {
    causes.push(cause.splitValue);
  }
  if (property !== '' && !property.startsWith('$.')) {
    // Node never matches, so nothing else matters.
    causes.push(cause.splitOnTraitName);
    return causes;
  }
  if (types.has('boolean')) {
    causes.push(cause.splitOnBoolean);
  }
  if (types.has('exponent-float')) {
    causes.push(cause.splitOnExponentFloat);
  }
  if (types.has('whole-float')) {
    causes.push(cause.wholeFloat);
  }
  if (types.has('zero-or-empty')) {
    causes.push(cause.splitOnZeroOrEmpty);
  }
  return causes;
}

/** Whether both engines resolve this `$.` property alike. */
function isVerifiedPath(property: string): boolean {
  if (VERIFIED_CONTEXT_PATHS.has(property) || DEPENDENCY_PATH.test(property)) {
    return true;
  }
  const dotted = TRAIT_DOT_PATH.exec(property)?.[1];
  if (dotted !== undefined) {
    // Node reads everything after the dot as the name; Python stops at another dot.
    return TRAIT_NAME.test(dotted);
  }
  const [, singleQuoted, doubleQuoted] = TRAIT_BRACKET_PATH.exec(property) ?? [];
  // Node reads a single-quoted name directly, and a double-quoted one through jsonpath-plus.
  return (
    singleQuoted !== undefined || (doubleQuoted !== undefined && TRAIT_NAME.test(doubleQuoted))
  );
}

/** Flags overridden by a warned segment, then flags whose segments read those through `$.flags`. */
function approximateFlags(
  segments: readonly LintedSegment[],
  warnings: readonly DivergenceWarning[],
): Record<string, DivergenceCause[]> {
  const approximate = new Map<string, DivergenceCause[]>();
  for (const warning of warnings) {
    for (const flag of warning.flags) {
      const causes = approximate.get(flag) ?? [];
      if (!causes.includes(warning.cause)) {
        causes.push(warning.cause);
      }
      approximate.set(flag, causes);
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const segment of segments) {
      const read = [...flagsReadBy(segment.rules)].find((name) => approximate.has(name));
      if (read === undefined) {
        continue;
      }
      for (const flag of segment.flags) {
        if (!approximate.has(flag)) {
          approximate.set(flag, [
            { code: 'R10', description: `reads ${read} through $.flags, which may differ` },
          ]);
          grew = true;
        }
      }
    }
  }
  // Flag names are unique, and code-unit order is the same on every machine.
  return Object.fromEntries([...approximate].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function observedTraitTypes(identities: readonly PreviewIdentity[]): Map<string, Set<Observed>> {
  const types = new Map<string, Set<Observed>>();
  for (const identity of identities) {
    for (const [key, trait] of Object.entries(identity.traits)) {
      const observed = types.get(key) ?? new Set<Observed>();
      for (const found of observe(trait)) {
        observed.add(found);
      }
      types.set(key, observed);
    }
  }
  return types;
}

function observe(trait: IdentityTrait): Observed[] {
  const value = coerceTraitValue(trait.value);
  if (value === null) {
    return ['null'];
  }
  if (typeof value === 'boolean') {
    return ['boolean'];
  }
  if (typeof value === 'string') {
    if (value === '') {
      return ['string', 'zero-or-empty'];
    }
    return Number.isNaN(Number.parseFloat(value)) ? ['string'] : ['string', 'number-prefixed-text'];
  }
  // A float trait, or a decimal string such as "20.0", is a float for Python even when whole.
  const isFloat =
    trait.valueType === 'float' ||
    (typeof trait.value === 'string' && pythonNumberKind(trait.value) === 'decimal');
  const found: Observed[] = [];
  if (!Number.isInteger(value)) {
    found.push('float');
  } else if (isFloat) {
    found.push('whole-float');
  } else {
    found.push('integer');
    if (value === 0) {
      found.push('zero-or-empty');
    }
  }
  if (value < 0) {
    found.push('negative');
  }
  const magnitude = Math.abs(value);
  if (isFloat && magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    found.push('exponent-float');
  }
  return found;
}

/** The trait a condition reads: a plain trait name, or one under `$.identity.traits`. */
function traitName(property: string): string | undefined {
  if (property === '') {
    return undefined;
  }
  if (!property.startsWith('$.')) {
    return property;
  }
  const dotted = TRAIT_DOT_PATH.exec(property)?.[1];
  if (dotted !== undefined) {
    return dotted;
  }
  const [, singleQuoted, doubleQuoted] = TRAIT_BRACKET_PATH.exec(property) ?? [];
  return singleQuoted ?? doubleQuoted;
}

function conditionsOf(rules: readonly SegmentRuleDoc[]): SegmentConditionDoc[] {
  return rules.flatMap((rule) => [...rule.conditions, ...conditionsOf(rule.rules)]);
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

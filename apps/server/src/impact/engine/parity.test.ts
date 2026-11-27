import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Flagsmith, LocalFileHandler } from '@flagsmith/nodejs';
import { beforeAll, describe, expect, it } from 'vitest';
import { lintDivergences, type DivergenceLint } from './divergence-lint.js';
import {
  importSdkDocumentMapper,
  loadFlagsmithEngine,
  PINNED_SDK_VERSION,
} from './flagsmith-internals.js';
import { evaluateIdentities, prepareServerProfile } from './server-profile.js';
import type {
  EnvironmentDocument,
  EvaluationRun,
  FlagValue,
  OutcomeSource,
  PreviewIdentity,
  TraitValue,
} from './types.js';

// The parity suite of architecture.md 10.6. The Python goldens come from Flagsmith's own engine,
// flagsmith-flag-engine 11.1.2 (the version Flagsmith 2.295.2 runs), fed by a port of the server's
// mapper. They are regenerated outside this repository, with that Python reference engine, only
// when a pin or a fixture document changes. CI needs no Python.

const fixtures = new URL('../../../test/fixtures/impact/', import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

const allIdentities = fixture('identities.1000.json') as PreviewIdentity[];
/** The goldens hold the first 250 identities, to keep the repository small. */
const identities = allIdentities.slice(0, 250);
const edgeIdentities = fixture('identities.edge.json') as PreviewIdentity[];

const scenarios = [
  { label: 'seeded', file: 'environment.seeded.json', identities },
  { label: 'proposed', file: 'environment.proposed.json', identities },
  { label: 'seeded-legacy-hashing', file: 'environment.seeded-legacy-hashing.json', identities },
  {
    label: 'proposed-legacy-hashing',
    file: 'environment.proposed-legacy-hashing.json',
    identities,
  },
  { label: 'edge-probes', file: 'environment.edge.json', identities: edgeIdentities },
].map((scenario) => ({ ...scenario, document: fixture(scenario.file) as EnvironmentDocument }));
const documentOf = (label: string) =>
  scenarios.find((scenario) => scenario.label === label)!.document;

type PythonFlag = {
  enabled: boolean;
  value: FlagValue;
  reason: string;
  variant: string | null;
  source: { kind: string; segmentId?: number; segmentName?: string };
};
type PythonGolden = {
  engine: string;
  mapper: string;
  results: Record<string, Record<string, PythonFlag>>;
  /** Identifier -> the error the engine raised, which fails Flagsmith's whole evaluation of it. */
  failures?: Record<string, string>;
};
type Comparison = { results: number; mismatches: string[] };
type GoldenComparison = Comparison & { failures: string[] };
type SdkResults = Record<string, Record<string, unknown>>;

/** Python gives a variant, or a SPLIT reason for a variant without a key, only after a split. */
const pythonFromSplit = (flag: PythonFlag) =>
  flag.variant !== null || flag.reason.startsWith('SPLIT;');

/**
 * C5: enabled, value, variant, whether a split chose the value, and the deciding segment of every
 * result, field by field.
 */
function compareWithGolden(run: EvaluationRun, golden: PythonGolden): GoldenComparison {
  const comparison: GoldenComparison = { results: 0, mismatches: [], failures: [] };
  for (const evaluation of run) {
    const failure = golden.failures?.[evaluation.identifier];
    if (failure !== undefined) {
      // Flagsmith serves this identity no flags at all.
      comparison.failures.push(`${evaluation.identifier} ${failure}`);
      continue;
    }
    const expected = golden.results[evaluation.identifier] ?? {};
    const flags = new Set([...Object.keys(evaluation.flags), ...Object.keys(expected)]);
    for (const flag of [...flags].sort()) {
      comparison.results++;
      const ours = evaluation.flags[flag];
      const python = expected[flag];
      const fields =
        ours === undefined || python === undefined
          ? ['missing']
          : [
              ours.enabled === python.enabled ? [] : ['enabled'],
              ours.value === python.value ? [] : ['value'],
              ours.variant === python.variant ? [] : ['variant'],
              ours.fromSplit === pythonFromSplit(python) ? [] : ['split'],
              sameSource(ours.source, python.source) ? [] : ['segment'],
            ].flat();
      if (fields.length > 0) {
        comparison.mismatches.push(`${evaluation.identifier} ${flag} ${fields.join(',')}`);
      }
    }
  }
  return comparison;
}

function sameSource(ours: OutcomeSource, python: PythonFlag['source']): boolean {
  if (ours.kind !== python.kind) {
    return false;
  }
  return (
    ours.kind !== 'segment' ||
    (ours.segmentId === python.segmentId && ours.segmentName === python.segmentName)
  );
}

/** C1: the public SDK in offline mode, exactly as an application uses it. */
async function evaluateWithPublicSdk(
  document: EnvironmentDocument,
  people: readonly PreviewIdentity[],
  directory: string,
): Promise<SdkResults> {
  // LocalFileHandler is the only public way to load a document, and it reads a file.
  const file = path.join(directory, `${document.api_key}.json`);
  writeFileSync(file, JSON.stringify(document));
  const client = new Flagsmith({ offlineMode: true, offlineHandler: new LocalFileHandler(file) });
  const results: SdkResults = {};
  try {
    for (const identity of people) {
      const flags = await client.getIdentityFlags(identity.identifier, rawTraits(identity));
      results[identity.identifier] = Object.fromEntries(
        flags.allFlags().map((flag) => [
          flag.featureName,
          {
            enabled: flag.enabled,
            value: flag.value,
            variant: flag.variant,
            reason: flag.reason,
          },
        ]),
      );
    }
  } finally {
    await client.close();
  }
  return results;
}

/** C1: the SDK's own document mapper and engine, called directly through the loader. */
async function evaluateEngineDirect(
  document: EnvironmentDocument,
  people: readonly PreviewIdentity[],
): Promise<SdkResults> {
  const [mapper, engine] = await Promise.all([importSdkDocumentMapper(), loadFlagsmithEngine()]);
  const context = mapper.getEvaluationContext(
    mapper.buildEnvironmentModel(structuredClone(document)),
  );
  const results: SdkResults = {};
  for (const identity of people) {
    const { flags } = engine.getEvaluationResult({
      ...context,
      identity: {
        identifier: identity.identifier,
        // What the engine hashes when the SDK sets no key itself.
        key: `${document.api_key}_${identity.identifier}`,
        traits: rawTraits(identity),
      },
    });
    results[identity.identifier] = Object.fromEntries(
      Object.values(flags).map((flag) => [
        flag.name,
        { enabled: flag.enabled, value: flag.value, variant: flag.variant, reason: flag.reason },
      ]),
    );
  }
  return results;
}

function rawTraits(identity: PreviewIdentity): Record<string, TraitValue> {
  return Object.fromEntries(
    Object.entries(identity.traits).map(([key, trait]) => [key, trait.value]),
  );
}

/** The SDK's Flag leaves an unset value, variant or reason undefined; the engine says null. */
const asJson = (value: unknown) => JSON.stringify(value, (_key, field: unknown) => field ?? null);

function compareSdkResults(left: SdkResults, right: SdkResults): Comparison {
  const comparison: Comparison = { results: 0, mismatches: [] };
  const identifiers = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const identifier of identifiers) {
    const ours = left[identifier] ?? {};
    const theirs = right[identifier] ?? {};
    for (const flag of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      comparison.results++;
      if (asJson(ours[flag]) !== asJson(theirs[flag])) {
        comparison.mismatches.push(`${identifier} ${flag}`);
      }
    }
  }
  return comparison;
}

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

type ScenarioResult = {
  label: string;
  identities: number;
  run: EvaluationRun;
  rerun: EvaluationRun;
  golden: PythonGolden;
  c5: GoldenComparison;
  c1: Comparison;
};

const results: ScenarioResult[] = [];
let edgeLint: DivergenceLint;
let realisticLint: DivergenceLint;

beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'flagops-c1-'));
  try {
    for (const scenario of scenarios) {
      const run = evaluateIdentities(
        await prepareServerProfile(scenario.document),
        scenario.identities,
      );
      // A second, independent evaluation: a fresh profile over fresh copies of the inputs.
      const rerun = evaluateIdentities(
        await prepareServerProfile(structuredClone(scenario.document)),
        structuredClone(scenario.identities),
      );
      const golden = fixture(`python/${scenario.label}.server.json`) as PythonGolden;
      results.push({
        label: scenario.label,
        identities: scenario.identities.length,
        run,
        rerun,
        golden,
        c5: compareWithGolden(run, golden),
        c1: compareSdkResults(
          await evaluateWithPublicSdk(scenario.document, scenario.identities, directory),
          await evaluateEngineDirect(scenario.document, scenario.identities),
        ),
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  edgeLint = lintDivergences([documentOf('edge-probes')], edgeIdentities);
  realisticLint = lintDivergences([documentOf('seeded'), documentOf('proposed')], allIdentities);
}, 120_000);

const resultOf = (label: string) => results.find((result) => result.label === label)!;

describe('C5 golden parity: the server profile against the Python engine', () => {
  it.each(['seeded', 'proposed', 'seeded-legacy-hashing', 'proposed-legacy-hashing'])(
    'matches every result of the %s fixture field by field',
    (label) => {
      const { run, golden, c5 } = resultOf(label);

      expect(golden.engine).toBe('flagsmith-flag-engine 11.1.2');
      expect(golden.mapper).toBe('server');
      expect(run.map((evaluation) => evaluation.identifier)).toEqual(Object.keys(golden.results));
      expect(c5.results).toBe(250 * 20);
      expect(c5.mismatches).toEqual([]);
      expect(c5.failures).toEqual([]);
    },
  );

  it('differs on the edge probes only for flags the divergence lint marks', () => {
    const { run, golden, c5 } = resultOf('edge-probes');
    const identifiers = run.map((evaluation) => evaluation.identifier);
    const failed = Object.keys(golden.failures ?? {});

    expect(Object.keys(golden.results)).toEqual(identifiers.filter((id) => !failed.includes(id)));
    // Python raises on a condition of each of these identities, so Flagsmith serves it nothing: a
    // MODULO by zero (R15), and REGEX patterns that only JavaScript compiles (R2).
    expect(c5.failures).toEqual([
      'p3_modulo_by_zero ZeroDivisionError: float modulo by zero',
      'p3_regex_named_group PatternError: unknown extension ?<n at position 1',
      'p3_regex_lookbehind PatternError: look-behind requires fixed-width pattern',
      'p3_regex_unbalanced PatternError: unbalanced parenthesis at position 1',
    ]);
    for (const [flag, code] of [
      ['probe_modulo_by_zero', 'R15'],
      ['probe_regex_js_named_group', 'R2'],
      ['probe_regex_variable_lookbehind', 'R2'],
      ['probe_regex_unbalanced_parenthesis', 'R2'],
    ] as const) {
      expect(edgeLint.approximate[flag]?.map((found) => found.code)).toEqual([code]);
    }
    // The other 27 identities x 86 flags.
    expect(c5.results).toBe(27 * 86);
    const unmarked = c5.mismatches.filter(
      (mismatch) => !Object.hasOwn(edgeLint.approximate, mismatch.split(' ')[1] ?? ''),
    );
    expect(unmarked).toEqual([]);
    // The spike's 24 probes and 19 identities come first. On them, the engines differ in the 39
    // results the spike found (REPORT section 4).
    const spikeFlags = new Set(
      documentOf('edge-probes')
        .feature_states.slice(0, 24)
        .map((state) => state.feature.name),
    );
    const spikeIdentities = new Set(identifiers.slice(0, 19));
    const onSpikeProbes = c5.mismatches.filter((mismatch) => {
      const [identifier = '', flag = ''] = mismatch.split(' ');
      return spikeIdentities.has(identifier) && spikeFlags.has(flag);
    });
    expect(onSpikeProbes).toHaveLength(39);
    expect(c5.mismatches).toHaveLength(160);
    // A split between options without a key, which C5 compares like every other flag.
    const unkeyed = run.map((evaluation) => evaluation.flags['probe_mv_unkeyed']);
    expect(new Set(unkeyed.map((outcome) => outcome?.variant))).toEqual(new Set([null, 'control']));
    expect(unkeyed.every((outcome) => outcome?.fromSplit)).toBe(true);
    // Every probe left out gives both engines the same results.
    expect(Object.keys(edgeLint.approximate)).toEqual([
      'probe_bool_modulo',
      'probe_bool_regex',
      'probe_dependency_on_bool_regex',
      'probe_environment_name_numeric',
      'probe_equal_decimal_string',
      'probe_flags_value_path',
      'probe_float_compared_with_text',
      'probe_float_in',
      'probe_identifier_numeric',
      'probe_in_empty_string',
      'probe_in_json_exponent',
      'probe_in_json_float_literals',
      'probe_in_json_nan',
      'probe_in_json_numbers',
      'probe_in_zero',
      'probe_int_vs_decimal_condition',
      'probe_is_not_set_without_property',
      'probe_modulo_by_zero',
      'probe_modulo_letters',
      'probe_modulo_negative_divisor',
      'probe_modulo_negative_trait',
      'probe_modulo_number_text',
      'probe_modulo_underscore',
      'probe_not_equal_non_numeric',
      'probe_regex_count_without_minimum',
      'probe_regex_dollar_newline',
      'probe_regex_dot_astral',
      'probe_regex_dot_carriage_return',
      'probe_regex_exponent_float',
      'probe_regex_first_bracket',
      'probe_regex_js_named_group',
      'probe_regex_key_unicode_word',
      'probe_regex_python_anchor',
      'probe_regex_python_syntax',
      'probe_regex_separator_space',
      'probe_regex_unbalanced_parenthesis',
      'probe_regex_unicode_boundary',
      'probe_regex_unicode_digit',
      'probe_regex_unicode_word',
      'probe_regex_variable_lookbehind',
      'probe_semver_boolean',
      'probe_semver_contains',
      'probe_semver_lenient_condition',
      'probe_semver_not_equal_build',
      'probe_semver_not_equal_text',
      'probe_semver_v_prefix',
      'probe_split_boolean',
      'probe_split_empty_trait',
      'probe_split_exponent_float',
      'probe_split_on_trait',
      'probe_split_value_letters',
      'probe_split_zero_trait',
      'probe_trait_path_digit_name',
      'probe_trait_path_dotted_name',
      'probe_whole_float_regex',
    ]);
  });

  it('raises no lint warning on the realistic fixtures', () => {
    expect(realisticLint).toEqual({ warnings: [], approximate: {} });
  });
});

describe('C1 parity: the public offline SDK against the engine-direct path', () => {
  it.each(scenarios.map((scenario) => scenario.label))(
    'agrees on every result of the %s fixture, reasons included',
    (label) => {
      const { identities: count, run, c1 } = resultOf(label);

      expect(c1.results).toBe(count * Object.keys(run[0]?.flags ?? {}).length);
      expect(c1.mismatches).toEqual([]);
    },
  );
});

describe('determinism', () => {
  it('gives identical output when the same inputs are evaluated again', () => {
    for (const { run, rerun } of results) {
      expect(rerun).toEqual(run);
    }
  });

  it('gives the same output on every run of the suite', async () => {
    const summary = {
      engine: `@flagsmith/nodejs ${PINNED_SDK_VERSION}`,
      scenarios: results.map(({ label, identities: count, run, golden, c5, c1 }) => ({
        label,
        identities: count,
        reference: golden.engine,
        c5,
        c1: { results: c1.results, mismatches: c1.mismatches.length },
        // Covers every field of every result, reasons included.
        sha256: sha256(run),
      })),
      edgeProbesApproximate: edgeLint.approximate,
    };

    await expect(`${JSON.stringify(summary, null, 2)}\n`).toMatchFileSnapshot(
      '../../../test/fixtures/impact/expected/parity-summary.json',
    );
  });
});

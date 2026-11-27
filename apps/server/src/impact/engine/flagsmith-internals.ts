/**
 * Loads the evaluation engine that ships inside `@flagsmith/nodejs` (architecture.md 10.1, D-040).
 *
 * The package's `exports` map covers only its root entry, which does not export the engine, so a
 * deep import fails with ERR_PACKAGE_PATH_NOT_EXPORTED. This module finds the installed package,
 * refuses every version except the one the parity suite verified, and imports the engine's ESM
 * build by file URL. It is the only module that knows the package's layout. The ESLint boundary
 * keeps every module outside impact/engine/ from importing the SDK at all.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FlagOpsError } from '@flagops/shared';
import type { FlagValue, TraitValue } from './types.js';

/** Change it only together with the pin in package.json, after re-running the parity suite. */
export const PINNED_SDK_VERSION = '9.5.0';

// The part of the engine's context and result schema that FlagOps builds and reads
// (flagsmith-engine/evaluation/evaluationContext and evaluationResult in the package).

export type EngineCondition = {
  property: string;
  operator: string;
  /** The engine also takes the values of an IN condition as a list. */
  value: string | string[];
};

export type EngineRule = {
  type: 'ALL' | 'ANY' | 'NONE';
  conditions: EngineCondition[];
  rules: EngineRule[];
};

export type EngineVariant = {
  value: FlagValue;
  weight: number;
  /** The engine allocates variants in ascending priority. */
  priority: number;
  key?: string;
};

/** The engine returns `metadata` unchanged on the result of the flag this context decides. */
export type EngineFeatureContext<Metadata> = {
  /** The bucketing seed of multivariate splits. */
  key: string;
  name: string;
  enabled: boolean;
  value: FlagValue;
  variants?: EngineVariant[];
  /** Overrides only: the lowest priority wins. */
  priority?: number;
  metadata?: Metadata;
};

export type EngineSegmentContext<Metadata> = {
  /** Percentage splits hash on it. */
  key: string;
  name: string;
  rules: EngineRule[];
  overrides?: EngineFeatureContext<Metadata>[];
  metadata?: Record<string, unknown>;
};

export type EngineContext<Metadata> = {
  environment: { key: string; name: string };
  identity?: {
    identifier: string;
    /** What multivariate splits and percentage-split segments hash. */
    key: string;
    traits: Record<string, TraitValue>;
  };
  features?: Record<string, EngineFeatureContext<Metadata>>;
  segments?: Record<string, EngineSegmentContext<Metadata>>;
};

export type EngineFlagResult<Metadata> = {
  name: string;
  enabled: boolean;
  value: FlagValue;
  variant: string | null;
  reason: string;
  metadata?: Metadata;
};

export type EngineResult<Metadata> = {
  flags: Record<string, EngineFlagResult<Metadata>>;
};

export type FlagsmithEngine = {
  readonly version: string;
  getEvaluationResult<Metadata>(context: EngineContext<Metadata>): EngineResult<Metadata>;
};

/** The SDK's `EnvironmentModel`, only ever handed back to the SDK. */
export type SdkEnvironmentModel = { readonly __brand: 'EnvironmentModel' };

/**
 * The SDK's own document-to-context path, which `Flagsmith.getIdentityFlags()` uses offline. Only
 * the C1 parity test uses it (architecture.md 10.6); previews build their context with the
 * server profile.
 */
export type SdkDocumentMapper = {
  buildEnvironmentModel(document: unknown): SdkEnvironmentModel;
  /** The context before an identity is added. */
  getEvaluationContext(environment: SdkEnvironmentModel): EngineContext<unknown>;
};

let installedEngine: Promise<FlagsmithEngine> | undefined;

/** The engine of the installed package, loaded once per process. */
export function loadFlagsmithEngine(): Promise<FlagsmithEngine> {
  installedEngine ??= importFlagsmithEngine();
  return installedEngine;
}

/** Imports the engine from the package in `packageRoot`, the installed one by default. */
export async function importFlagsmithEngine(
  packageRoot = installedPackageRoot(),
): Promise<FlagsmithEngine> {
  const version = await checkVersion(packageRoot);
  const engine = await importBuildFile(packageRoot, 'flagsmith-engine/index.js');
  return {
    version,
    getEvaluationResult: exportedFunction(
      engine,
      'getEvaluationResult',
    ) as FlagsmithEngine['getEvaluationResult'],
  };
}

/** Imports the SDK's document mapper from the package in `packageRoot`, the installed one by default. */
export async function importSdkDocumentMapper(
  packageRoot = installedPackageRoot(),
): Promise<SdkDocumentMapper> {
  await checkVersion(packageRoot);
  const [environments, mappers] = await Promise.all([
    importBuildFile(packageRoot, 'flagsmith-engine/environments/util.js'),
    importBuildFile(packageRoot, 'flagsmith-engine/evaluation/evaluationContext/mappers.js'),
  ]);
  return {
    buildEnvironmentModel: exportedFunction(
      environments,
      'buildEnvironmentModel',
    ) as SdkDocumentMapper['buildEnvironmentModel'],
    getEvaluationContext: exportedFunction(
      mappers,
      'getEvaluationContext',
    ) as SdkDocumentMapper['getEvaluationContext'],
  };
}

function installedPackageRoot(): string {
  // The root entry resolves through the "require" condition to <root>/build/cjs/index.js.
  const entry = createRequire(import.meta.url).resolve('@flagsmith/nodejs');
  return path.resolve(path.dirname(entry), '..', '..');
}

async function checkVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (manifest.version !== PINNED_SDK_VERSION) {
    const found = typeof manifest.version === 'string' ? manifest.version : 'an unknown version';
    throw new FlagOpsError(
      'internal_error',
      `@flagsmith/nodejs ${found} is installed, but the impact preview is verified with ${PINNED_SDK_VERSION} only. ` +
        'Install the locked dependencies (pnpm install --frozen-lockfile), or re-run the parity suite before changing the pin.',
    );
  }
  return manifest.version;
}

async function importBuildFile(
  packageRoot: string,
  file: string,
): Promise<Record<string, unknown>> {
  const url = pathToFileURL(path.join(packageRoot, 'build', 'esm', file)).href;
  return (await import(url)) as Record<string, unknown>;
}

function exportedFunction(module: Record<string, unknown>, name: string): unknown {
  const value = module[name];
  if (typeof value !== 'function') {
    throw new FlagOpsError(
      'internal_error',
      `@flagsmith/nodejs ${PINNED_SDK_VERSION} no longer exports ${name} where the impact preview expects it.`,
    );
  }
  return value;
}

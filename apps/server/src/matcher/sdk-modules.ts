/**
 * What the matcher knows about the Flagsmith SDKs, as data (architecture.md 8.2 and 8.3, D-042).
 * Verified against `@flagsmith/flagsmith` 12.6.0, `flagsmith` 10.0.0, `@flagsmith/nodejs` 9.5.0,
 * `flagsmith-nodejs` 8.1.2 and `@flagsmith/react-native` 12.6.0 (codemod REPORT section 1). Only
 * this file names SDK packages, exports, methods and options; other modules use these constants,
 * or the `ReactHook` type for the hooks.
 */

/** The SDK a read goes through; it decides how a flag name is looked up (D-043). */
export type Product = 'client' | 'react' | 'node';

/** The JavaScript client's packages: current, legacy, React Native and the ESM build. */
const clientPackages = [
  '@flagsmith/flagsmith',
  'flagsmith',
  '@flagsmith/react-native',
  'react-native-flagsmith',
  'flagsmith-es',
];

const nodePackages = ['@flagsmith/nodejs', 'flagsmith-nodejs'];

const clientEntries = new Set(
  clientPackages.flatMap((name) => [name, `${name}/isomorphic`, `${name}/next-middleware`]),
);
const reactEntries = new Set(clientPackages.map((name) => `${name}/react`));
const nodeEntries = new Set(nodePackages);

/** `flagsmith/react.js` is `flagsmith/react` (survey 4.1): the suffix is dropped from subpaths. */
function withoutJsSuffix(specifier: string): string {
  const scoped = specifier.startsWith('@');
  const parts = specifier.split('/');
  const packageParts = scoped ? 2 : 1;
  if (parts.length <= packageParts) {
    return specifier;
  }
  return specifier.replace(/\.m?js$/, '');
}

/**
 * The product of an SDK module specifier, `types` for imports that only carry types (the
 * `/types` entry and deep imports such as `flagsmith-nodejs/build/sdk/models`), or undefined
 * for any other module.
 */
export function sdkModule(specifier: string): Product | 'types' | undefined {
  const entry = withoutJsSuffix(specifier);
  if (clientEntries.has(entry)) {
    return 'client';
  }
  if (reactEntries.has(entry)) {
    return 'react';
  }
  if (nodeEntries.has(entry)) {
    return 'node';
  }
  const isDeepImport = [...clientPackages, ...nodePackages].some((name) =>
    entry.startsWith(`${name}/`),
  );
  return isDeepImport ? 'types' : undefined;
}

/** The products a `package.json` dependency name brings: the client package also ships React. */
export function productsOfPackage(name: string): readonly Product[] {
  if (clientPackages.includes(name)) {
    return ['client', 'react'];
  }
  return nodePackages.includes(name) ? ['node'] : [];
}

/** Methods of a traced client that read a flag (rules C1-C3). */
export const clientReads = {
  hasFeature: 'C1',
  getValue: 'C2',
  getExperimentFlag: 'C3',
} as const satisfies Record<string, string>;

/** Methods of a Node `Flags` object that read a flag (rules N1-N3); any receiver in a Node package. */
export const nodeFlagsReads = {
  isFeatureEnabled: 'N1',
  getFeatureValue: 'N2',
  getFlag: 'N3',
} as const satisfies Record<string, string>;

/** Node client methods that read a flag (rule N4). */
export const nodeClientReads = { getExperimentFlag: 'N4' } as const satisfies Record<
  string,
  string
>;

/** React hooks that read flags: `useFlags` (R1 destructured, R2 as an object) and `useExperiment`. */
export const reactHooks = ['useFlags', 'useFlagsmith', 'useExperiment'] as const;

export type ReactHook = (typeof reactHooks)[number];

/** Node client methods whose result is a `Flags` object. */
export const nodeFlagsFetches = ['getEnvironmentFlags', 'getIdentityFlags'] as const;

/**
 * Calls that may read a flag through a receiver or callee the matcher cannot trace, in a package
 * that uses the client or React SDK: `unattributed` records (architecture.md 8.3, D-044).
 */
export const untracedClientMethods = new Set(['hasFeature', 'getValue', 'getExperimentFlag']);
export const untracedHooks = new Set(['useFlags', 'useExperiment']);

/** The client reads a W1 wrapper may pass its name to: C1 and C2 (D-043). */
export const wrappableClientReads: ReadonlySet<string> = new Set(['hasFeature', 'getValue']);

/** The Node `Flags` reads a W1 wrapper may pass its name to: N1 and N2. */
export const wrappableNodeReads: ReadonlySet<string> = new Set([
  'isFeatureEnabled',
  'getFeatureValue',
]);

/** The client module's factory: its result is a client. */
export const clientFactory = 'createFlagsmithInstance';

/** The Node module's class: `new Flagsmith(...)` is a Node client. */
export const nodeClientClass = 'Flagsmith';

/** The global the browser builds assign the client to (codemod REPORT 1.1). */
export const clientGlobal = 'flagsmith';

/** The browser builds also install the client on these globals, as `window.flagsmith`. */
export const clientGlobals = ['window', 'globalThis', 'self'] as const;

/**
 * Where the client takes its `defaultFlags` option (rule D1): the client's `init(options)`, and
 * the `options` prop of the React provider.
 */
export const defaultFlagsOption = 'defaultFlags';
export const clientInit = 'init';
export const reactProvider = 'FlagsmithProvider';
export const reactProviderOptions = 'options';

/** The client SDK's own key rule: `key.toLowerCase().replace(/ /g, '_')`. */
export function normaliseClientName(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

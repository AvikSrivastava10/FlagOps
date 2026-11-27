// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const server = 'apps/server/src';
const services = [
  'inventory',
  'scanner',
  'ownership',
  'exitplan',
  'retire',
  'identities',
  'promote',
  'auth',
];

/**
 * A relative import that enters one of the given directories of apps/server/src. Server modules
 * import each other by relative path, so a whole path segment identifies the module.
 */
function into(directories, message, allowTypeImports = false) {
  return { regex: `(^|/)(${directories.join('|')})(/|$)`, message, allowTypeImports };
}

const fileSystem = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
  name,
  message: 'Engines are pure: the caller reads files and passes their contents in.',
}));
const network = ['node:net', 'net'].map((name) => ({
  name,
  message: 'Engines are pure: only adapters talk to the network.',
}));
const flagsmithSdk = {
  regex: '^@flagsmith/',
  message:
    'Only impact/engine/ loads the Flagsmith SDK, through its version-checked loader (D-040).',
};
const babel = { regex: '^@babel/', message: 'The lifecycle engine does not parse code.' };
const adapters = into(
  ['db', 'flagsmith', 'github', 'http'],
  'Engines are pure: they get their data from the caller, never from the database, an adapter or the HTTP layer.',
);

/** One config object per directory, because a later `no-restricted-imports` replaces an earlier one. */
function restrict(files, { paths = [], patterns = [] }) {
  return { files, rules: { 'no-restricted-imports': ['error', { paths, patterns }] } };
}

// The module boundaries of structure.md section 2. Later entries override earlier ones for the
// files they match, so each entry repeats the restrictions that still apply.
const boundaries = [
  restrict([`${server}/**/*.ts`], { patterns: [flagsmithSdk] }),
  restrict([`${server}/lifecycle/**/*.ts`], {
    paths: [...fileSystem, ...network],
    patterns: [adapters, babel, flagsmithSdk],
  }),
  restrict([`${server}/matcher/**/*.ts`, `${server}/codemod/**/*.ts`], {
    paths: [...fileSystem, ...network],
    patterns: [adapters, flagsmithSdk],
  }),
  restrict([`${server}/impact/**/*.ts`], { paths: network, patterns: [adapters, flagsmithSdk] }),
  restrict([`${server}/impact/engine/**/*.ts`], { patterns: [adapters] }),
  restrict([`${server}/flagsmith/**/*.ts`], {
    patterns: [
      into(['github', 'http', ...services], 'The Flagsmith adapter depends only on config.'),
      flagsmithSdk,
    ],
  }),
  restrict([`${server}/github/**/*.ts`], {
    patterns: [
      into(['flagsmith', 'http', ...services], 'The GitHub adapter depends only on config.'),
      flagsmithSdk,
    ],
  }),
  restrict(
    services.map((service) => `${server}/${service}/**/*.ts`),
    { patterns: [into(['http'], 'Services do not depend on the HTTP layer.'), flagsmithSdk] },
  ),
  restrict([`${server}/http/**/*.ts`], {
    patterns: [
      into(
        ['flagsmith', 'github'],
        'Routes call services; only types may come from the adapters.',
        true,
      ),
      flagsmithSdk,
    ],
  }),
  restrict(['apps/web/src/**/*.{ts,tsx}'], {
    paths: [{ name: '@flagops/server', message: 'The web app reaches the server only over HTTP.' }],
    patterns: [
      {
        regex: '^(\\.\\./)+(apps/)?server(/|$)',
        message: 'The web app reaches the server only over HTTP.',
      },
    ],
  }),
];

export default defineConfig(
  {
    ignores: [
      '.agents/**',
      'docs/**',
      'examples/**',
      'data/**',
      '.worktrees/**',
      '**/dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'apps/server/src/flagsmith/openapi/schema.d.ts',
      'apps/server/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './packages/shared/tsconfig.json',
          './apps/server/tsconfig.json',
          './apps/web/tsconfig.json',
          './apps/web/tsconfig.node.json',
          './tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Fastify hooks and handlers are async to use its promise-based lifecycle, awaiting or not.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true },
        },
      ],
    },
  },
  {
    files: [`${server}/**/*.ts`],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='prepare'] > TemplateLiteral[expressions.length>0]",
          message: 'Never build SQL from strings: pass values as statement parameters.',
        },
        {
          selector: "CallExpression[callee.property.name='prepare'] > BinaryExpression",
          message: 'Never build SQL from strings: pass values as statement parameters.',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  ...boundaries,
  {
    files: ['**/*.test.{ts,tsx}', 'apps/server/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
);

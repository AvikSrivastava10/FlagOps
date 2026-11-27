import { parse, type ParserOptions, type ParserPlugin } from '@babel/parser';
import traverseModule from '@babel/traverse';
import type * as t from '@babel/types';

/**
 * Babel parsing for the matcher and the codemod (architecture.md 8.1, 9.1). Babel is used for
 * positions, scopes and references only; nothing is ever printed from the AST.
 */

/** @babel/traverse is CommonJS: under Node's ESM interop its function sits on `.default`. */
type Traverse = typeof traverseModule.default;
export const traverse: Traverse =
  (traverseModule as unknown as { default?: Traverse }).default ??
  (traverseModule as unknown as Traverse);

/** The plugins follow the extension; a `.js` file is never parsed as TypeScript (8.1). */
function parserOptions(path: string): ParserOptions {
  const language: ParserPlugin[] = /\.[cm]?ts$/.test(path)
    ? ['typescript']
    : path.endsWith('.tsx')
      ? ['typescript', 'jsx']
      : ['jsx'];
  return {
    sourceType: 'module',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    attachComment: false,
    errorRecovery: false,
    plugins: [...language, 'decorators-legacy', 'importAttributes', 'explicitResourceManagement'],
  };
}

export type ParseResult = { ok: true; ast: t.File } | { ok: false; message: string };

/** Parses one file. A file that does not parse is reported, never guessed at. */
export function parseSource(path: string, text: string): ParseResult {
  try {
    return { ok: true, ast: parse(text, parserOptions(path)) as unknown as t.File };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

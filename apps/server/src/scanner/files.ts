import { posix } from 'node:path';
import { accessorConfigPath } from '../matcher/accessor-config.js';
import { isCodeFile } from '../matcher/paths.js';
import { codeownersLocations } from './codeowners.js';

/**
 * File selection (architecture.md 8.1): the code files the matcher parses, plus the few other
 * files it reads: every `package.json` (package context), the root `tsconfig.json` or
 * `jsconfig.json` (path aliases), `flagops.json` and the CODEOWNERS locations.
 */
export const maxFileBytes = 1024 * 1024;

const excludedSegments = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'vendor',
  '.next',
  'out',
]);

const rootFiles = new Set([
  'tsconfig.json',
  'jsconfig.json',
  accessorConfigPath,
  ...codeownersLocations,
]);

/** Whether the scanner reads a repository-relative path at all. */
export function isSelected(path: string): boolean {
  if (path.split('/').some((segment) => excludedSegments.has(segment))) {
    return false;
  }
  return isCodeFile(path) || posix.basename(path) === 'package.json' || rootFiles.has(path);
}

/**
 * A repository-relative POSIX path from an archive entry, without the archive's top-level folder,
 * or undefined when the entry would leave the repository (architecture.md 19).
 */
export function safeRelativePath(entryPath: string): string | undefined {
  const path = entryPath.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    return undefined;
  }
  const withoutRoot = posix.normalize(path.split('/').slice(1).join('/'));
  return withoutRoot === '.' || withoutRoot === '' ? undefined : withoutRoot;
}

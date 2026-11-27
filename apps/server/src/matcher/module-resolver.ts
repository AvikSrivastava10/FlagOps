import { builtinModules } from 'node:module';
import { posix } from 'node:path';

/**
 * Resolves import specifiers to repository files, without installed dependencies (codemod REPORT
 * 4.1, D-043): relative paths with extension and `index` probing, `.js` written for a `.ts` file,
 * and the root `tsconfig.json` or `jsconfig.json` `baseUrl` and `paths`.
 */
export type Resolution =
  { kind: 'file'; path: string } | { kind: 'package' } | { kind: 'unresolved' };

export type ModuleResolver = { resolve(fromFile: string, specifier: string): Resolution };

const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const packageName = /^(@[a-z0-9~][\w.~-]*\/)?[a-z0-9~][\w.~-]*(\/.*)?$/i;

type PathAlias = { prefix: string; suffix: string; targets: string[] };

type CompilerOptions = { baseUrl?: unknown; paths?: unknown };

/** tsconfig files allow comments and trailing commas, which JSON.parse does not. */
function parseJsonWithComments(text: string): unknown {
  const withoutComments = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, quoted: string | undefined) => quoted ?? '',
  );
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'));
}

function compilerOptionsOf(text: string | undefined): CompilerOptions {
  if (text === undefined) {
    return {};
  }
  try {
    const config = parseJsonWithComments(text) as { compilerOptions?: CompilerOptions } | null;
    return config?.compilerOptions ?? {};
  } catch {
    // An unreadable tsconfig leaves aliases unresolved; the import is then a package import.
    return {};
  }
}

export function createModuleResolver(
  filePaths: Iterable<string>,
  tsconfigText?: string,
): ModuleResolver {
  const files = new Set(filePaths);
  const options = compilerOptionsOf(tsconfigText);
  const baseUrl =
    typeof options.baseUrl === 'string'
      ? posix
          .normalize(options.baseUrl)
          .replace(/^\.\/?$/, '')
          .replace(/\/$/, '')
      : undefined;
  const aliases: PathAlias[] = [];
  if (typeof options.paths === 'object' && options.paths !== null) {
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets)) {
        continue;
      }
      const star = pattern.indexOf('*');
      aliases.push({
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? '' : pattern.slice(star + 1),
        targets: targets
          .filter((target): target is string => typeof target === 'string')
          .map((target) => posix.join(baseUrl ?? '', target)),
      });
    }
  }

  function probe(base: string): string | undefined {
    const path = posix.normalize(base).replace(/^\.\//, '');
    if (files.has(path)) {
      return path;
    }
    const withExtension = extensions.map((extension) => path + extension).find((p) => files.has(p));
    if (withExtension !== undefined) {
      return withExtension;
    }
    // ESM TypeScript writes './x.js' for './x.ts'.
    const jsSuffix = /\.[cm]?jsx?$/.exec(path);
    if (jsSuffix !== null) {
      const stem = path.slice(0, -jsSuffix[0].length);
      const typed = ['.ts', '.tsx', '.mts', '.cts']
        .map((ext) => stem + ext)
        .find((p) => files.has(p));
      if (typed !== undefined) {
        return typed;
      }
    }
    return extensions.map((extension) => `${path}/index${extension}`).find((p) => files.has(p));
  }

  function resolveAlias(specifier: string): Resolution | undefined {
    for (const alias of aliases) {
      const matches =
        specifier.startsWith(alias.prefix) &&
        specifier.endsWith(alias.suffix) &&
        specifier.length >= alias.prefix.length + alias.suffix.length;
      if (!matches) {
        continue;
      }
      const middle = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
      for (const target of alias.targets) {
        const hit = probe(target.replace('*', middle));
        if (hit !== undefined) {
          return { kind: 'file', path: hit };
        }
      }
      return { kind: 'unresolved' };
    }
    return undefined;
  }

  return {
    resolve(fromFile, specifier) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const base = specifier.startsWith('/')
          ? specifier.slice(1)
          : posix.join(posix.dirname(fromFile), specifier);
        const hit = probe(base);
        return hit === undefined ? { kind: 'unresolved' } : { kind: 'file', path: hit };
      }
      if (builtins.has(specifier)) {
        return { kind: 'package' };
      }
      const aliased = resolveAlias(specifier);
      if (aliased !== undefined) {
        return aliased;
      }
      if (baseUrl !== undefined) {
        const hit = probe(posix.join(baseUrl, specifier));
        if (hit !== undefined) {
          return { kind: 'file', path: hit };
        }
      }
      return packageName.test(specifier) ? { kind: 'package' } : { kind: 'unresolved' };
    },
  };
}

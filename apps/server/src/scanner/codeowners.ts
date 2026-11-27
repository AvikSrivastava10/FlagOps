import ignore, { type Ignore } from 'ignore';

/**
 * CODEOWNERS (architecture.md 8.4): the first existing of these locations at the scanned commit,
 * parsed line by line. For each file, the last matching line wins. Paths match case-sensitively,
 * as GitHub matches them.
 */
export const codeownersLocations = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

export type Owner = { handle: string; kind: 'user' | 'team' | 'email' };

export type CodeownersLine = { line: number; text: string; owners: Owner[]; matcher: Ignore };

export type Codeowners = {
  path: string;
  lines: CodeownersLine[];
  errors: { line: number; text: string; reason: string }[];
};

/** The winning line for a file: its owners, possibly none, and where they come from. */
export type OwnerMatch = { owners: Owner[]; line: number; text: string };

function ownerOf(token: string): Owner | undefined {
  if (/^@[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(token)) {
    return { handle: token, kind: 'team' };
  }
  if (/^@[A-Za-z0-9-]+$/.test(token)) {
    return { handle: token, kind: 'user' };
  }
  return /^[^@\s]+@[^@\s]+$/.test(token) ? { handle: token, kind: 'email' } : undefined;
}

export function parseCodeowners(path: string, text: string): Codeowners {
  const codeowners: Codeowners = { path, lines: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/(^|\s)#.*$/, '').trim();
    if (content === '') {
      return;
    }
    const [pattern = '', ...tokens] = content.split(/\s+/);
    const reject = (reason: string) => codeowners.errors.push({ line, text: raw.trim(), reason });
    // GitHub's CODEOWNERS supports neither negation nor character ranges.
    if (pattern.startsWith('!')) {
      reject('negated patterns are not supported in CODEOWNERS');
      return;
    }
    if (/\[[^\]]*\]/.test(pattern)) {
      reject('character ranges are not supported in CODEOWNERS');
      return;
    }
    const owners = tokens.map(ownerOf);
    const invalid = tokens.find((_, position) => owners[position] === undefined);
    if (invalid !== undefined) {
      reject(`${invalid} is not a user, team or email`);
      return;
    }
    codeowners.lines.push({
      line,
      text: raw.trim(),
      owners: owners.filter((owner): owner is Owner => owner !== undefined),
      // `ignore` folds case unless told otherwise.
      matcher: ignore({ ignorecase: false }).add(pattern),
    });
  });
  return codeowners;
}

/** The last line whose pattern matches the file; a matching line without owners means no owner. */
export function ownersOf(codeowners: Codeowners, filePath: string): OwnerMatch | undefined {
  for (let index = codeowners.lines.length - 1; index >= 0; index -= 1) {
    const entry = codeowners.lines[index];
    if (entry?.matcher.ignores(filePath) === true) {
      return { owners: entry.owners, line: entry.line, text: entry.text };
    }
  }
  return undefined;
}

import { gzipSync } from 'node:zlib';
import { Header } from 'tar';

/**
 * Builds a gzipped tarball in memory, shaped like GitHub's: every entry under one top-level
 * folder `<owner>-<repo>-<short sha>/`. Raw entries let tests add links and unsafe paths.
 */
export type TarEntry =
  | { path: string; text: string }
  | { path: string; link: string }
  | { path: string; directory: true };

const block = 512;

function header(
  path: string,
  size: number,
  type: 'File' | 'SymbolicLink' | 'Directory',
  linkpath?: string,
): Buffer {
  const buffer = Buffer.alloc(block);
  new Header({
    path,
    mode: type === 'Directory' ? 0o755 : 0o644,
    size,
    mtime: new Date('2026-11-27T10:00:00Z'),
    type,
    ...(linkpath === undefined ? {} : { linkpath }),
  }).encode(buffer, 0);
  return buffer;
}

function padded(content: Buffer): Buffer {
  const remainder = content.length % block;
  return remainder === 0 ? content : Buffer.concat([content, Buffer.alloc(block - remainder)]);
}

export function tarEntries(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    if ('text' in entry) {
      const content = Buffer.from(entry.text, 'utf8');
      parts.push(header(entry.path, content.length, 'File'), padded(content));
    } else if ('link' in entry) {
      parts.push(header(entry.path, 0, 'SymbolicLink', entry.link));
    } else {
      parts.push(header(entry.path, 0, 'Directory'));
    }
  }
  parts.push(Buffer.alloc(block * 2));
  return gzipSync(Buffer.concat(parts));
}

/** A repository's files as GitHub's tarball of `sha` holds them. */
export function repositoryTarball(
  repository: string,
  sha: string,
  files: Readonly<Record<string, string>>,
): Buffer {
  const root = `${repository.replace('/', '-')}-${sha.slice(0, 7)}/`;
  return tarEntries([
    { path: root, directory: true },
    ...Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, text]) => ({ path: root + path, text })),
  ]);
}

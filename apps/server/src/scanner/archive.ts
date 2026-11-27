import { Parser, type ReadEntry } from 'tar';
import type { SkippedFile } from '../db/repos/scans.js';
import type { RepositoryFile } from '../matcher/match-repository.js';
import { isSelected, maxFileBytes, safeRelativePath } from './files.js';

/**
 * Reads a repository tarball in memory (architecture.md 8.1, 19). Nothing is written to disk.
 * Paths that would leave the repository are rejected, links are skipped, and only the files the
 * scanner selects are kept, each as UTF-8 text of at most 1 MB.
 */
export type ArchiveContents = { files: RepositoryFile[]; skipped: SkippedFile[] };

const fileTypes = new Set(['File', 'OldFile', 'ContiguousFile']);
const linkTypes = new Set(['SymbolicLink', 'Link']);

export async function readArchive(archive: Uint8Array): Promise<ArchiveContents> {
  const files: RepositoryFile[] = [];
  const skipped: SkippedFile[] = [];
  const reading: Promise<void>[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parser = new Parser({ strict: true });

  parser.on('entry', (entry: ReadEntry) => {
    const path = safeRelativePath(entry.path);
    const keep = (reason: string | undefined): void => {
      if (reason !== undefined) {
        skipped.push({ path: path ?? entry.path, reason });
      }
      entry.resume();
    };
    if (path === undefined) {
      keep(fileTypes.has(entry.type) ? 'its path leaves the repository' : undefined);
      return;
    }
    if (!isSelected(path)) {
      keep(undefined);
      return;
    }
    if (linkTypes.has(entry.type)) {
      keep('a link, which the scanner does not follow');
      return;
    }
    if (!fileTypes.has(entry.type)) {
      keep(undefined);
      return;
    }
    if (entry.size > maxFileBytes) {
      keep('larger than 1 MB');
      return;
    }
    const chunks: Buffer[] = [];
    entry.on('data', (chunk: Buffer) => chunks.push(chunk));
    reading.push(
      new Promise((resolve) => {
        entry.on('end', () => {
          try {
            files.push({ path, text: decoder.decode(Buffer.concat(chunks)) });
          } catch {
            skipped.push({ path, reason: 'not UTF-8 text' });
          }
          resolve();
        });
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject);
    parser.on('end', () => {
      resolve();
    });
    parser.end(Buffer.from(archive));
  });
  await Promise.all(reading);
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  return { files: files.sort(byPath), skipped: skipped.sort(byPath) };
}

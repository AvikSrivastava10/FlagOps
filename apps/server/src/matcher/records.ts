import type { RecordKind } from '@flagops/shared';
import type { Product } from './sdk-modules.js';

/**
 * One finding of a scan (architecture.md 8.3, table `code_refs` in 16). Every record keeps the
 * evidence that produced it, so each match is explainable.
 */
export type CodeRecord = {
  kind: RecordKind;
  /** The canonical Flagsmith name, for references and mentions; null otherwise. */
  flagName: string | null;
  /** The name as the code writes it, when it is static. */
  literal: string | null;
  product: Product | null;
  /** N1-N4, C1-C3, R1-R3, W1, D1, `via-accessor:...`, or `mention`. */
  ruleId: string;
  method: string | null;
  filePath: string;
  /** 1-based line and column of the flag-name argument, or of the call when there is none. */
  line: number;
  column: number;
  /** False for Node reads matched by method name on an untraced receiver (D-043). */
  traced: boolean;
  evidence: string;
  /** The source line, trimmed, at most 200 characters. */
  snippet: string;
  /** For an unresolved name: the closest Flagsmith name, when one is close (Zombie, 5.4). */
  suggestion: string | null;
};

/** Line and column lookups for one file's text. */
export type SourceLines = {
  position(offset: number): { line: number; column: number };
  snippet(line: number): string;
};

const snippetLength = 200;

export function sourceLines(text: string): SourceLines {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  const lines = text.split(/\r?\n/);
  return {
    position(offset) {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((starts[middle] ?? 0) <= offset) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
    },
    snippet(line) {
      return (lines[line - 1] ?? '').trim().slice(0, snippetLength);
    },
  };
}

/** Sorts records by file, position, kind and flag, so every scan of a commit is identical. */
export function compareRecords(a: CodeRecord, b: CodeRecord): number {
  return (
    a.filePath.localeCompare(b.filePath) ||
    a.line - b.line ||
    a.column - b.column ||
    a.kind.localeCompare(b.kind) ||
    (a.flagName ?? '').localeCompare(b.flagName ?? '')
  );
}

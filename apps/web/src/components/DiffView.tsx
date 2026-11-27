import { CodeDiff } from './CodeDiff';
import { ConfigDiff } from './ConfigDiff';
import type { DiffViewProps } from './diff-data';

export type {
  CodeDiffProps,
  ConfigDiffProps,
  ConfigField,
  ConfigValue,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffViewProps,
} from './diff-data';

/**
 * The two diffs of ui-design.md 5: `config`, the side-by-side configuration diff of a promotion,
 * and `code`, the unified code diff of a retirement, where a deleted file shows its removed lines
 * (BN-2).
 */
export function DiffView(props: DiffViewProps) {
  return props.mode === 'config' ? (
    <ConfigDiff {...props} />
  ) : (
    <CodeDiff files={props.files} headingLevel={props.headingLevel} />
  );
}

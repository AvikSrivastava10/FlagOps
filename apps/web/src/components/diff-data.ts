import type { HeadingLevel } from './Heading';

/** One side of a configuration field; null when the field is not set on that side. */
export type ConfigValue = {
  text: string;
  /** Values, segment rules and keys are shown in the mono face (ui-design.md 3.2). */
  mono?: boolean | undefined;
} | null;

export type ConfigField = {
  id: string;
  /** "Enabled", "Value", "Segment override: beta_testers", "Identity overrides", "Dependencies". */
  label: string;
  source: ConfigValue;
  target: ConfigValue;
  changed: boolean;
  /** "not changed by promotion", "only in source", "only in target, removed by this promotion". */
  note?: string | undefined;
};

export type ConfigDiffProps = {
  mode: 'config';
  /** Names the comparison, such as "dark_mode, Staging to Production". */
  caption: string;
  sourceName: string;
  targetName: string;
  fields: readonly ConfigField[];
};

export type DiffLine = {
  kind: 'context' | 'add' | 'del';
  text: string;
  /** Line number in the old file; null on an added line. */
  oldLine: number | null;
  /** Line number in the new file; null on a removed line. */
  newLine: number | null;
};

export type DiffHunk = {
  /** The hunk header, such as "@@ -12,7 +12,5 @@". */
  header: string;
  lines: readonly DiffLine[];
};

export type DiffFile = {
  path: string;
  /** A deleted file comes with its removed lines, so its content shows, not only its name (BN-2). */
  change: 'modified' | 'added' | 'deleted';
  hunks: readonly DiffHunk[];
};

export type CodeDiffProps = {
  mode: 'code';
  files: readonly DiffFile[];
  /** The level of each file path's heading, to fit the screen's outline. Defaults to 4. */
  headingLevel?: HeadingLevel | undefined;
};

export type DiffViewProps = ConfigDiffProps | CodeDiffProps;

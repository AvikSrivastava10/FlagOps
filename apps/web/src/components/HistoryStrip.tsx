import { stageLabels, type StageId } from '@flagops/shared';
import styles from './HistoryStrip.module.css';

export type HistoryEntry = {
  stage: StageId;
  /** When the flag reached the stage, as display text, for example "2026-11-20". */
  since: string;
};

export type HistoryStripProps = {
  /** The stages the flag has been at, oldest first. */
  entries: readonly HistoryEntry[];
  /** `word`: a word-sized strip (EvidenceCard). `dated`: the strip with each stage and date. */
  variant?: 'word' | 'dated' | undefined;
};

/** Space between two stops on the strip, in SVG units (px). */
const step = 14;
const end = 5;

/**
 * A word-sized history of the stages a flag has been at (ui-design.md 1, sparklines): a short
 * line with one stop per stage and a ring on the current one. Stops are evenly spaced, because
 * order matters more than duration, as on a line diagram.
 */
export function HistoryStrip({ entries, variant = 'word' }: HistoryStripProps) {
  if (entries.length === 0) return <span className={styles.empty}>No stage history yet</span>;
  const width = (entries.length - 1) * step + end * 2;
  const last = entries.length - 1;
  return (
    <span className={styles.strip} data-variant={variant}>
      <svg
        className={styles.line}
        viewBox={`0 0 ${width} 12`}
        width={width}
        height={12}
        aria-hidden="true"
        focusable="false"
      >
        {last > 0 && <path d={`M${end} 6H${end + last * step}`} />}
        {entries.map((entry, index) =>
          index === last ? (
            <circle key={index} className={styles.current} cx={end + index * step} cy={6} r={4} />
          ) : (
            <path key={index} d={`M${end + index * step} 2V10`} />
          ),
        )}
      </svg>
      <ol className={variant === 'dated' ? styles.dates : 'visually-hidden'}>
        {entries.map((entry, index) => (
          <li key={index}>
            <span className={styles.stage}>{stageLabels[entry.stage]}</span>{' '}
            <span className={styles.since}>since {entry.since}</span>
          </li>
        ))}
      </ol>
    </span>
  );
}

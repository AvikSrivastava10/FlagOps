import { Fragment } from 'react';
import { cx } from '../lib/class-names';
import { Link } from './Link';
import { Tooltip } from './Tooltip';
import styles from './EvidenceLine.module.css';

/** A number that links to its source: an environment row, a scan or a PR (ui-design.md 5). */
export type EvidenceNumber = {
  text: string;
  href: string;
  /** Where the number comes from, shown on hover and focus (ui-design.md 7). */
  source: string;
  /** The source is outside FlagOps, such as a PR on GitHub. */
  external?: boolean | undefined;
};

/** One segment of the line: plain text with the numbers that link to their sources. */
export type EvidenceSegment = readonly (string | EvidenceNumber)[];

export type EvidenceLineProps = {
  segments: readonly EvidenceSegment[];
  /**
   * Off inside the evidence card, which is a description and holds no controls: the numbers are
   * plain text there, and the flag page carries the links.
   */
  interactive?: boolean | undefined;
  className?: string | undefined;
};

/** Evidence segments separated by " · "; each number links to its source (ui-design.md 5). */
export function EvidenceLine({ segments, interactive = true, className }: EvidenceLineProps) {
  return (
    <p className={cx(styles.line, className)}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && <span className={styles.separator}> · </span>}
          <span>
            {segment.map((part, partIndex) =>
              typeof part === 'string' || !interactive ? (
                <Fragment key={partIndex}>{typeof part === 'string' ? part : part.text}</Fragment>
              ) : (
                <Tooltip key={partIndex} text={part.source}>
                  {(trigger) => (
                    <Link
                      href={part.href}
                      external={part.external === true}
                      className={styles.number}
                      {...trigger}
                    >
                      {part.text}
                    </Link>
                  )}
                </Tooltip>
              ),
            )}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

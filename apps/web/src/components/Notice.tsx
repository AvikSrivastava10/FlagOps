import type { ReactNode } from 'react';
import { cx } from '../lib/class-names';
import { Icon, type IconName } from './icons/Icon';
import styles from './Notice.module.css';

export type NoticeProps = {
  /** `notice`: yellow band, ink text. `danger`: red band, white text, for errors and blocks. */
  tone?: 'notice' | 'danger' | undefined;
  /** The notice glyph, such as a health condition's (ui-design.md 4). */
  glyph?: IconName | undefined;
  title: string;
  /** The evidence, or for an error what failed, why, and the next step (ui-design.md 6.11). */
  children?: ReactNode;
  /** The error code, shown in mono. */
  code?: string | undefined;
  /** The request ID of an internal error. */
  requestId?: string | undefined;
  className?: string | undefined;
};

/**
 * A service notice on the line (ui-design.md 5): a yellow band with the notice glyph, a title and
 * the evidence; the danger variant is red with white text. The title and text carry the meaning,
 * so the colour never does it alone.
 */
export function Notice({
  tone = 'notice',
  glyph,
  title,
  children,
  code,
  requestId,
  className,
}: NoticeProps) {
  return (
    <div className={cx(styles.band, styles[tone], className)} data-tone={tone}>
      {glyph !== undefined && <Icon name={glyph} className={styles.glyph} />}
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children !== undefined && <div className={styles.text}>{children}</div>}
        {(code !== undefined || requestId !== undefined) && (
          <p className={styles.meta}>
            {code !== undefined && (
              <span>
                Code <code>{code}</code>
              </span>
            )}
            {requestId !== undefined && (
              <span>
                Request ID <code>{requestId}</code>
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

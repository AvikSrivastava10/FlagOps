import type { ReactNode } from 'react';
import { cx } from '../lib/class-names';
import { Icon, type IconName } from './icons/Icon';
import styles from './Banner.module.css';

export type BannerProps = {
  /** `danger` for connection problems and rate limits; `notice` for stale data and versions. */
  tone: 'danger' | 'notice';
  glyph?: IconName | undefined;
  /** One sentence naming the system, the cause and what is shown meanwhile (ui-design.md 6.11). */
  children: ReactNode;
  /** Makes the banner dismissible, as the version mismatch banner is. */
  onDismiss?: (() => void) | undefined;
};

/**
 * Full-width band under the signage bar (ui-design.md 5) for connection problems, stale data and
 * a version mismatch. It stays in view while the page scrolls.
 */
export function Banner({ tone, glyph, children, onDismiss }: BannerProps) {
  return (
    <div className={cx(styles.banner, styles[tone])} data-tone={tone}>
      <div className={styles.inner}>
        {glyph !== undefined && <Icon name={glyph} />}
        <p className={styles.message}>{children}</p>
        {onDismiss !== undefined && (
          <button type="button" className={styles.dismiss} onClick={onDismiss}>
            <Icon name="close" label="Dismiss" />
          </button>
        )}
      </div>
    </div>
  );
}

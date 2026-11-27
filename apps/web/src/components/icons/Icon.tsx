import { cx } from '../../lib/class-names';
import { glyphs, type IconName } from './glyphs';
import styles from './Icon.module.css';

export type { IconName } from './glyphs';

export type IconProps = {
  name: IconName;
  /** The icon's text alternative. Leave it out only when a text label sits next to the icon. */
  label?: string | undefined;
  /** CSS Module lookups are `string | undefined` under `noUncheckedIndexedAccess`. */
  className?: string | undefined;
};

/** One icon of the FlagOps set (ui-design.md 4). It takes the colour of the surrounding text. */
export function Icon({ name, label, className }: IconProps) {
  const a11y =
    label === undefined
      ? { 'aria-hidden': true as const }
      : { role: 'img' as const, 'aria-label': label };
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      focusable="false"
      {...a11y}
    >
      {glyphs[name]}
    </svg>
  );
}

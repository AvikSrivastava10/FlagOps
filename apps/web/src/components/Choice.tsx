import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/class-names';
import { Icon } from './icons/Icon';
import styles from './Choice.module.css';

export type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  /** A checkbox, or one radio of a group sharing a `name`. */
  type: 'checkbox' | 'radio';
  label: ReactNode;
};

/** A checkbox or radio with its label, at least 24 x 24px (ui-design.md 3.3). */
export function Choice({ type, label, className, ...props }: ChoiceProps) {
  return (
    <label className={styles.choice}>
      <input {...props} type={type} className={cx(styles.input, className)} />
      <span className={styles.label}>{label}</span>
    </label>
  );
}

export type FilterChipProps = {
  /**
   * Text only. A pressed chip is ink, and route bullets sit only on light surfaces (ui-design.md
   * 3.1), so a type chip names the type in words.
   */
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
};

/**
 * A filter chip on the board's filter row (ui-design.md 6.3), a toggle button. A filled lamp
 * marks it on and a ring marks it off, so the state never rests on colour alone.
 */
export function FilterChip({ label, pressed, onPressedChange }: FilterChipProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={pressed}
      onClick={() => {
        onPressedChange(!pressed);
      }}
    >
      <Icon name={pressed ? 'lamp-on' : 'lamp-off'} className={styles.state} />
      <span className={styles.chipLabel}>{label}</span>
    </button>
  );
}

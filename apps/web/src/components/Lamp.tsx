import { cx } from '../lib/class-names';
import { Icon } from './icons/Icon';
import type { IconName } from './icons/glyphs';
import styles from './Lamp.module.css';

/** What an environment serves (architecture.md 5.2): ON or OFF to everyone, or PARTIAL. */
export type ServeState = 'on' | 'partial' | 'off';

export type LampProps = {
  state: ServeState;
  /** The served value as display text, shown in mono; leave it out when there is none. */
  value?: string | null;
};

const labels: Readonly<Record<ServeState, string>> = { on: 'ON', partial: 'PARTIAL', off: 'OFF' };

const glyphs: Readonly<Record<ServeState, IconName>> = {
  on: 'lamp-on',
  partial: 'lamp-partial',
  off: 'lamp-off',
};

/** Serve-state indicator (ui-design.md 5): the lamp's shape and its label carry the state. */
export function Lamp({ state, value = null }: LampProps) {
  return (
    <span className={cx(styles.lamp, styles[state])} data-state={state}>
      <Icon name={glyphs[state]} className={styles.glyph} />
      <span className={styles.label}>{labels[state]}</span>
      {value !== null && (
        <>
          <span className="visually-hidden">, value </span>
          <code className={styles.value}>{value}</code>
        </>
      )}
    </span>
  );
}

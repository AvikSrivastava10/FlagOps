import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../lib/class-names';
import { Icon, type IconName } from './icons/Icon';
import styles from './Field.module.css';

type FieldFrame = {
  label: string;
  /** Help shown under the label and read as the control's description. */
  hint?: string | undefined;
  /** A validation message; the control is marked invalid while it is set. */
  error?: string | null | undefined;
};

function useFieldIds(hint: string | undefined, error: string | null | undefined) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = cx(hint !== undefined && hintId, error != null && errorId) || undefined;
  return { id, hintId, errorId, describedBy };
}

function Frame({
  id,
  label,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FieldFrame & { id: string; hintId: string; errorId: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {children}
      {error != null && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

export type TextFieldProps = FieldFrame &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'children'> & {
    /** Flag keys, codes and URLs are typed in the mono face (ui-design.md 3.2). */
    mono?: boolean | undefined;
    /** A leading glyph, such as search. */
    icon?: IconName | undefined;
  };

/** A labelled text input: 2px ink border, paper-raised fill, the line-colour focus ring. */
export function TextField({ label, hint, error, mono = false, icon, ...props }: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <Frame {...{ id, label, hint, hintId, error, errorId }}>
      <span className={cx(styles.control, icon !== undefined && styles.withIcon)}>
        {icon !== undefined && <Icon name={icon} className={styles.icon} />}
        <input
          {...props}
          id={id}
          className={cx(styles.input, mono && styles.mono)}
          aria-describedby={describedBy}
          aria-invalid={error != null || undefined}
        />
      </span>
    </Frame>
  );
}

export type SelectFieldProps = FieldFrame &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> & {
    options: readonly { value: string; label: string }[];
  };

/** A labelled native select, styled like the text input. */
export function SelectField({ label, hint, error, options, ...props }: SelectFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <Frame {...{ id, label, hint, hintId, error, errorId }}>
      <span className={cx(styles.control, styles.select)}>
        <select
          {...props}
          id={id}
          className={styles.input}
          aria-describedby={describedBy}
          aria-invalid={error != null || undefined}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" className={styles.chevron} />
      </span>
    </Frame>
  );
}

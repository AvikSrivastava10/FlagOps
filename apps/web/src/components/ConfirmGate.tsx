import { useId, useState, type SyntheticEvent } from 'react';
import { Button } from './Button';
import { TextField } from './Field';
import { Notice } from './Notice';
import styles from './ConfirmGate.module.css';

export type ConfirmGateProps = {
  /** The change restated in one sentence, from the preview. */
  sentence: string;
  /** The target environment, such as "Production". */
  targetName: string;
  /** The flag name to type for production; null when the target needs no typed confirmation. */
  confirmName: string | null;
  /** A plain verb, such as "Apply to Production" (ui-design.md 7). */
  actionLabel: string;
  onConfirm: () => void;
  /** Set while the change is being applied, so a second click does nothing. */
  busy?: boolean | undefined;
  /** Blocking problems in plain words. They replace the gate with a danger notice. */
  blockers?: readonly string[] | undefined;
};

/**
 * The confirmation block of a promotion (ui-design.md 5, 6.6): the restated sentence, the
 * typed-name input for production, and the Apply button, enabled only when the typed name matches
 * exactly. Blocking problems replace the whole gate with a danger notice.
 */
export function ConfirmGate({
  sentence,
  targetName,
  confirmName,
  actionLabel,
  onConfirm,
  busy = false,
  blockers = [],
}: ConfirmGateProps) {
  const sentenceId = useId();
  const [typed, setTyped] = useState('');
  if (blockers.length > 0) {
    return (
      <Notice tone="danger" title={`This change cannot be applied to ${targetName}`}>
        <ul className={styles.blockers}>
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </Notice>
    );
  }

  const matches = confirmName === null || typed === confirmName;
  const reason = busy
    ? 'The change is being applied.'
    : matches
      ? null
      : `Type ${confirmName} exactly to enable this button.`;
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason === null) onConfirm();
  };
  return (
    <form className={styles.gate} onSubmit={submit} aria-labelledby={sentenceId}>
      <p id={sentenceId} className={styles.sentence}>
        {sentence}
      </p>
      {confirmName !== null && (
        <TextField
          label={`Type ${confirmName} to apply to ${targetName}`}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          mono
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="danger" disabledReason={reason}>
          {actionLabel}
        </Button>
      </div>
    </form>
  );
}

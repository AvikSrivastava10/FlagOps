import { Fragment } from 'react';
import { cx } from '../lib/class-names';
import styles from './FlagName.module.css';

export type FlagNameProps = {
  name: string;
  className?: string | undefined;
};

/**
 * A flag key in the mono face (ui-design.md 3.2). It may break after every underscore, and
 * anywhere when a part is still too long, so a name never clips (ui-design.md 5, FlagEntry).
 */
export function FlagName({ name, className }: FlagNameProps) {
  const parts = name.split('_');
  return (
    <code className={cx(styles.name, className)} data-flag-name="">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </Fragment>
      ))}
    </code>
  );
}

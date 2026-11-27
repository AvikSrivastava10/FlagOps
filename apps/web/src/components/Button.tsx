import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from '../lib/class-names';
import { Icon, type IconName } from './icons/Icon';
import { Link, type LinkProps } from './Link';
import { Tooltip } from './Tooltip';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type Common = {
  /** Primary: ink with white text. Secondary: 2px ink outline. Danger: red with white text. */
  variant?: ButtonVariant | undefined;
  icon?: IconName | undefined;
  children: ReactNode;
};

export type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> & {
    /**
     * Why the action is not allowed now. The button is then disabled, and the reason shows in a
     * tooltip and in text beside it (ui-design.md 5). It stays focusable, so keyboard users can
     * reach the reason, and it stays the same element when the reason comes and goes, so focus
     * never drops.
     */
    disabledReason?: string | null | undefined;
  };

function Content({ icon, children }: Pick<Common, 'icon' | 'children'>) {
  return (
    <>
      {icon !== undefined && <Icon name={icon} />}
      <span>{children}</span>
    </>
  );
}

const ignore = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
};

/** A square button with a plain verb (ui-design.md 7). */
export function Button({
  variant = 'primary',
  icon,
  children,
  disabledReason = null,
  className,
  type = 'button',
  onClick,
  ...props
}: ButtonProps) {
  const disabled = disabledReason !== null;
  return (
    <span className={styles.group}>
      <Tooltip text={disabledReason}>
        {(trigger) => (
          <button
            {...props}
            {...trigger}
            type={type}
            className={cx(styles.button, styles[variant], disabled && styles.disabled, className)}
            aria-disabled={disabled || undefined}
            onClick={disabled ? ignore : onClick}
          >
            <Content icon={icon}>{children}</Content>
          </button>
        )}
      </Tooltip>
      {disabled && <span className={styles.reason}>{disabledReason}</span>}
    </span>
  );
}

export type ButtonLinkProps = Common & Omit<LinkProps, 'children'>;

/** A link that looks like a button, for actions that open another screen, such as Promote. */
export function ButtonLink({
  variant = 'secondary',
  icon,
  children,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link {...props} className={cx(styles.button, styles[variant], className)}>
      <Content icon={icon}>{children}</Content>
    </Link>
  );
}

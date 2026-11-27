import { useId, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../lib/anchored-position';
import { useHoverFocus } from '../lib/use-hover-focus';
import styles from './Tooltip.module.css';

/** What the trigger spreads: the tooltip's id as its description, a ref and the hover handlers. */
export type TooltipTriggerProps = {
  'aria-describedby': string;
  /** A callback ref, so it fits any element type. */
  ref: (element: HTMLElement | null) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

export type TooltipProps = {
  text: string;
  /** Renders the trigger, which must be focusable, with the given props. */
  children: (trigger: TooltipTriggerProps) => ReactElement;
};

/**
 * A short text shown on hover and on keyboard focus (ui-design.md 7: numbers come with their
 * source on hover or focus). It renders in a portal with fixed coordinates clamped to the
 * viewport, so a scrolling region never clips it. The pointer can rest on it, and Escape hides it
 * wherever focus is (WCAG 1.4.13). The text stays in the document while hidden, so the trigger's
 * description is always complete.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [tip, setTip] = useState<HTMLSpanElement | null>(null);
  const { open, triggerProps, contentProps } = useHoverFocus();
  const position = useAnchoredPosition(trigger, tip, open);
  return (
    <>
      {children({ 'aria-describedby': id, ref: setTrigger, ...triggerProps })}
      {createPortal(
        <span
          role="tooltip"
          id={id}
          ref={setTip}
          className={styles.tip}
          hidden={!open}
          style={open ? position : undefined}
          {...contentProps}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';

/**
 * How long hover content stays after the pointer leaves, so the pointer can cross the gap from the
 * trigger onto the content (WCAG 1.4.13, hoverable).
 */
const closeDelayMs = 150;

type Handlers = { onMouseEnter: () => void; onMouseLeave: () => void };

export type HoverFocus = {
  open: boolean;
  /** Spread on the trigger. */
  triggerProps: Handlers & { onFocus: () => void; onBlur: () => void };
  /** Spread on the content, so the pointer can rest on it. */
  contentProps: Handlers;
};

/**
 * Content shown while its trigger is hovered or has keyboard focus: a tooltip or the evidence card
 * (WCAG 1.4.13). Escape hides it wherever focus is, and it stays hidden until hover and focus have
 * both left the trigger.
 */
export function useHoverFocus(): HoverFocus {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = (hovered || focused) && !dismissed;

  if (dismissed && !hovered && !focused) setDismissed(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDismissed(true);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const hover: Handlers = {
    onMouseEnter: () => {
      window.clearTimeout(closeTimer.current);
      setHovered(true);
    },
    onMouseLeave: () => {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        setHovered(false);
      }, closeDelayMs);
    },
  };

  return {
    open,
    triggerProps: {
      ...hover,
      onFocus: () => {
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
      },
    },
    contentProps: hover,
  };
}

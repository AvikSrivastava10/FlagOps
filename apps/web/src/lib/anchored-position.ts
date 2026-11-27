import { useLayoutEffect, useState, type CSSProperties } from 'react';

type Box = { top: number; left: number; width: number; height: number };

/** Space kept between a popover and the anchor, and between a popover and the viewport edge. */
const gap = 4;
const edge = 8;

/**
 * Where a popover goes: below its anchor when it fits, otherwise above it, so it never covers the
 * anchor (ui-design.md 5, EvidenceCard). It starts at the anchor's left edge and is moved left
 * as far as needed to stay inside the viewport.
 */
export function placePopover(
  anchor: Box,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - popover.height;
  const fitsBelow = below + popover.height <= viewport.height - edge;
  const top = fitsBelow || above < edge ? below : above;
  const maxLeft = Math.max(viewport.width - edge - popover.width, edge);
  const left = Math.min(Math.max(anchor.left, edge), maxLeft);
  return { top, left };
}

/**
 * Fixed coordinates for a popover rendered in a portal, which no scrolling region can clip. While
 * the popover is open, the position follows scrolling of any ancestor and resizing. The elements
 * come from callback refs held in state.
 */
export function useAnchoredPosition(
  anchor: HTMLElement | null,
  popover: HTMLElement | null,
  open: boolean,
): CSSProperties {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || anchor === null || popover === null) return;
    function update() {
      if (anchor === null || popover === null) return;
      const box = anchor.getBoundingClientRect();
      setPosition(
        placePopover(
          { top: box.top, left: box.left, width: box.width, height: box.height },
          { width: popover.offsetWidth, height: popover.offsetHeight },
          { width: document.documentElement.clientWidth, height: window.innerHeight },
        ),
      );
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor, popover, open]);

  // Until the first measurement the popover is laid out out of sight, so it never flashes at 0,0.
  return position === null
    ? { top: 0, left: 0, visibility: 'hidden' }
    : { top: position.top, left: position.left };
}

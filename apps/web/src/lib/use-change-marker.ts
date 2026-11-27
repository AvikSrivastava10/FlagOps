import { useEffect, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';

/** How long a changed item shows its static "Changed" marker under reduced motion (ui-design.md 3.4). */
export const changedMarkerMs = 10_000;

export type ChangeDisplay = {
  /**
   * Play the item's change animation. Consumers key the animated element on the change key, so
   * every new change remounts it and plays the animation once more.
   */
  animate: boolean;
  /** Show the static "Changed" marker instead. */
  showMarker: boolean;
};

/**
 * Decides how an item shows that it changed (ui-design.md 3.4: motion only marks real changes).
 * `changeKey` takes a new value on every change while the item stays mounted. The key an item
 * mounts with counts as seen, so returning to a screen animates nothing. `changedOnMount` counts
 * the mount itself as a change instead, for an item that mounts because it changed, such as a flag
 * arriving at its new station; it is read when the item mounts. With motion the item animates;
 * with reduced motion it shows the static marker for 10 seconds instead, counted from the latest
 * change.
 */
export function useChangeMarker(changeKey: number | null, changedOnMount = false): ChangeDisplay {
  const reduced = useReducedMotion();
  const [seenKey, setSeenKey] = useState(changeKey);
  const [changed, setChanged] = useState(changedOnMount);
  // Counts the changes since the marker last cleared; 0 while no marker shows.
  const [marked, setMarked] = useState(changedOnMount ? 1 : 0);
  if (changeKey !== seenKey) {
    setSeenKey(changeKey);
    setChanged(changeKey !== null);
    setMarked(changeKey === null ? 0 : marked + 1);
  }

  useEffect(() => {
    if (marked === 0) return;
    const timer = window.setTimeout(() => {
      setMarked(0);
    }, changedMarkerMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [marked]);

  return { animate: changed && !reduced, showMarker: reduced && marked !== 0 };
}

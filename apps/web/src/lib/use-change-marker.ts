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
 * `changeKey` takes a new value on every change. The key an item mounts with counts as already
 * seen, so returning to a screen animates nothing. With motion the item animates; with reduced
 * motion it shows the static marker for 10 seconds instead, counted from the latest change.
 */
export function useChangeMarker(changeKey: number | null): ChangeDisplay {
  const reduced = useReducedMotion();
  const [seenKey, setSeenKey] = useState(changeKey);
  const [changed, setChanged] = useState(false);
  const [markedKey, setMarkedKey] = useState<number | null>(null);
  if (changeKey !== seenKey) {
    setSeenKey(changeKey);
    setChanged(changeKey !== null);
    setMarkedKey(changeKey);
  }

  useEffect(() => {
    if (markedKey === null) return;
    const timer = window.setTimeout(() => {
      setMarkedKey(null);
    }, changedMarkerMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [markedKey]);

  return { animate: changed && !reduced, showMarker: reduced && markedKey !== null };
}

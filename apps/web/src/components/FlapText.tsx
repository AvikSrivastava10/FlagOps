import { useState } from 'react';
import { cx } from '../lib/class-names';
import { useChangeMarker } from '../lib/use-change-marker';
import { ChangedMarker } from './ChangedMarker';
import styles from './FlapText.module.css';

/** At most 8 characters flip on a change (ui-design.md 3.4); the others change in place. */
export const maxFlippedCharacters = 8;

export type FlapTextProps = {
  /** The text in sentence case; the tiles show it in capitals, assistive technology reads it as is. */
  text: string;
  /** A new value on every real change of `text`, such as a stage change after a sync. */
  changeKey?: number | null | undefined;
  /** Pads the board to a fixed number of tiles, so a column of flaps does not jump. */
  cells?: number | undefined;
  size?: 'small' | 'regular' | 'large' | undefined;
};

/** The positions that differ between two texts, at most `maxFlippedCharacters` of them. */
export function changedPositions(previous: string, next: string): number[] {
  const positions: number[] = [];
  for (let index = 0; index < next.length && positions.length < maxFlippedCharacters; index++) {
    if (next[index] !== previous[index]) positions.push(index);
  }
  return positions;
}

/**
 * Split-flap label (ui-design.md 5): mono capitals on dark tiles with a split line. On a real
 * change up to 8 changed tiles flip, 45ms apart, within 400ms. Under reduced motion nothing flips,
 * and the static "Changed" marker shows for 10 seconds instead.
 */
export function FlapText({ text, changeKey = null, cells = 0, size = 'regular' }: FlapTextProps) {
  const { animate, showMarker } = useChangeMarker(changeKey);
  const [change, setChange] = useState({ key: changeKey, text, previous: text });
  if (change.key !== changeKey) setChange({ key: changeKey, text, previous: change.text });
  else if (change.text !== text) setChange({ key: changeKey, text, previous: text });

  const tiles = text.toUpperCase().padEnd(cells, ' ');
  const flipped = animate ? changedPositions(change.previous.toUpperCase(), tiles) : [];
  return (
    <span className={cx(styles.flap, styles[size])} data-flap="">
      <span className="visually-hidden">{text}</span>
      {/* Keyed on the change, so every change remounts the tiles and plays the flip once more. */}
      <span className={styles.tiles} aria-hidden="true" key={changeKey ?? 'initial'}>
        {Array.from(tiles).map((character, index) => {
          const order = flipped.indexOf(index);
          return (
            <span
              key={index}
              className={cx(styles.tile, order >= 0 && styles.flip)}
              style={
                order >= 0 ? { animationDelay: `calc(var(--flap-step) * ${order})` } : undefined
              }
              data-flipping={order >= 0 ? '' : undefined}
            >
              {character === ' ' ? '\u00a0' : character}
            </span>
          );
        })}
      </span>
      {showMarker && <ChangedMarker />}
    </span>
  );
}

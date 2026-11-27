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

/** Splits the tiles into words, keeping each character's position, so lines break between words. */
function words(tiles: string): { start: number; characters: string[] }[] {
  const groups: { start: number; characters: string[] }[] = [];
  Array.from(tiles).forEach((character, index) => {
    const last = groups.at(-1);
    const startsWord = last === undefined || (character === ' ') !== (last.characters[0] === ' ');
    if (startsWord) groups.push({ start: index, characters: [character] });
    else last.characters.push(character);
  });
  return groups;
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
  // Both texts are padded the same way, so a blank tile that stays blank does not flip.
  const previousTiles = change.previous.toUpperCase().padEnd(cells, ' ');
  const flipped = animate ? changedPositions(previousTiles, tiles) : [];
  return (
    <span className={cx(styles.flap, styles[size])} data-flap="">
      <span className="visually-hidden">{text}</span>
      {/* Keyed on the change, so every change remounts the tiles and plays the flip once more. */}
      <span className={styles.tiles} aria-hidden="true" key={changeKey ?? 'initial'}>
        {words(tiles).map((word) => (
          <span key={word.start} className={styles.word}>
            {word.characters.map((character, offset) => {
              const order = flipped.indexOf(word.start + offset);
              return (
                <span
                  key={offset}
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
        ))}
      </span>
      {showMarker && <ChangedMarker />}
    </span>
  );
}

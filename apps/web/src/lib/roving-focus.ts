import { useState, type FocusEvent, type KeyboardEvent } from 'react';

/**
 * Roving focus (ui-design.md 8): a composite widget is one tab stop, and the arrow keys move focus
 * inside it. Items are addressed by group (a station, a table row) and by position in the group.
 */
export type RovingCell = { group: number; item: number };

/** Computes where a key moves focus, or null when the key does not move it. */
export type RovingMove = (
  from: RovingCell,
  key: string,
  sizes: readonly number[],
  withCtrl: boolean,
) => RovingCell | null;

/** The props that make an element one item of the widget. */
export type RovingItemProps = {
  tabIndex: 0 | -1;
  'data-roving': string;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
};

function lastItem(sizes: readonly number[], group: number): number {
  return Math.max((sizes[group] ?? 1) - 1, 0);
}

/**
 * The board (ui-design.md 6.3). Groups are stations; item 0 is the station itself and the flags
 * follow. Left and Right go to the previous or next station, Up and Down move within the station,
 * and Home and End go to the first and last station.
 */
export const moveInStations: RovingMove = (from, key, sizes) => {
  const lastGroup = sizes.length - 1;
  switch (key) {
    // At either end of the line there is no station to move to, so focus stays where it is.
    case 'ArrowRight':
      return from.group < lastGroup ? { group: from.group + 1, item: 0 } : null;
    case 'ArrowLeft':
      return from.group > 0 ? { group: from.group - 1, item: 0 } : null;
    case 'ArrowDown':
      return { group: from.group, item: Math.min(from.item + 1, lastItem(sizes, from.group)) };
    case 'ArrowUp':
      return { group: from.group, item: Math.max(from.item - 1, 0) };
    case 'Home':
      return { group: 0, item: 0 };
    case 'End':
      return { group: lastGroup, item: 0 };
    default:
      return null;
  }
};

/**
 * A table (the timetable). Groups are rows. Left and Right move within the row, Up and Down keep
 * the position in the row above or below, Home and End go to the start and end of the row, and
 * Ctrl with Home or End to the first and last item of the table.
 */
export const moveInRows: RovingMove = (from, key, sizes, withCtrl) => {
  const lastGroup = sizes.length - 1;
  const toRow = (group: number): RovingCell => ({
    group,
    item: Math.min(from.item, lastItem(sizes, group)),
  });
  switch (key) {
    case 'ArrowRight':
      return { group: from.group, item: Math.min(from.item + 1, lastItem(sizes, from.group)) };
    case 'ArrowLeft':
      return { group: from.group, item: Math.max(from.item - 1, 0) };
    case 'ArrowDown':
      return toRow(Math.min(from.group + 1, lastGroup));
    case 'ArrowUp':
      return toRow(Math.max(from.group - 1, 0));
    case 'Home':
      return withCtrl ? { group: 0, item: 0 } : { group: from.group, item: 0 };
    case 'End':
      return withCtrl
        ? { group: lastGroup, item: lastItem(sizes, lastGroup) }
        : { group: from.group, item: lastItem(sizes, from.group) };
    default:
      return null;
  }
};

function cellKey(cell: RovingCell): string {
  return `${cell.group}:${cell.item}`;
}

/**
 * Keeps one item of the widget tabbable and moves focus with the keys of `move`. `sizes` holds the
 * number of items in each group. The container gets `onKeyDown`; each item spreads
 * `itemProps(group, item)`. The item that last had focus stays the tab stop.
 */
export function useRovingFocus(sizes: readonly number[], move: RovingMove) {
  const [active, setActive] = useState<RovingCell>({ group: 0, item: 0 });
  const group = Math.max(Math.min(active.group, sizes.length - 1), 0);
  const current: RovingCell = { group, item: Math.min(active.item, lastItem(sizes, group)) };

  function itemProps(itemGroup: number, item: number): RovingItemProps {
    return {
      tabIndex: itemGroup === current.group && item === current.item ? 0 : -1,
      'data-roving': cellKey({ group: itemGroup, item }),
      onFocus: (event) => {
        // Focus events bubble in React: only the item that received focus becomes the tab stop.
        if (event.target === event.currentTarget) setActive({ group: itemGroup, item });
      },
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!(event.target instanceof HTMLElement) || event.target.dataset['roving'] === undefined) {
      return;
    }
    const next = move(current, event.key, sizes, event.ctrlKey || event.metaKey);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-roving="${cellKey(next)}"]`)?.focus();
  }

  return { itemProps, onKeyDown };
}

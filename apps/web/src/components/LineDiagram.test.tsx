import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedMarkerMs } from '../lib/use-change-marker';
import type { BoardStations } from './board-layout';
import type { FlagEntryData } from './FlagEntry';
import entryStyles from './FlagEntry.module.css';
import { LineDiagram } from './LineDiagram';
import { StripMap } from './StripMap';
import { setUpComponentTests } from './test-utils';

const media = setUpComponentTests();

function flag(name: string): FlagEntryData {
  return {
    id: name,
    name,
    type: 'release',
    health: [],
    href: `/flags/${name}`,
    zone: 'live',
    owners: [],
    history: [],
    evidence: [],
  };
}

// A sync that moves dark_mode from Rolling out to Released, where free_shipping_threshold stays.
const freeShipping = flag('free_shipping_threshold');
const darkMode = flag('dark_mode');
const beforeSync: BoardStations = { rolling_out: [darkMode], released: [freeShipping] };
const afterSync: BoardStations = { released: [freeShipping, darkMode] };

const arrivedClass = entryStyles.arrived ?? '';

/** The body of a flag's entry at a station: the element that slides in. */
function entryBody(container: HTMLElement, stage: string, name: string): Element | null {
  return container.querySelector(`section[data-stage="${stage}"] a[href="/flags/${name}"] > span`);
}

/** The names of the flags whose entries play the arrival. */
function arriving(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-flag-entry] > span')]
    .filter((body) => body.classList.contains(arrivedClass))
    .map((body) => body.querySelector('[data-flag-name]')?.textContent ?? null);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LineDiagram', () => {
  it('slides a flag that moved station into its new station, and only that flag', () => {
    expect(arrivedClass).not.toBe('');
    const { container, rerender } = render(<LineDiagram stations={beforeSync} />);
    expect(arriving(container)).toEqual([]);

    rerender(<LineDiagram stations={afterSync} />);
    expect(entryBody(container, 'rolling_out', 'dark_mode')).toBeNull();
    expect(entryBody(container, 'released', 'dark_mode')?.classList.contains(arrivedClass)).toBe(
      true,
    );
    expect(arriving(container)).toEqual(['dark_mode']);
    expect(container.querySelector('[data-changed-marker]')).toBeNull();
  });

  it('animates nothing when it mounts, as on a return to the board', () => {
    const { container } = render(<LineDiagram stations={afterSync} />);
    expect(arriving(container)).toEqual([]);
    expect(container.querySelector('[data-changed-marker]')).toBeNull();
  });

  it('shows the Changed marker on the moved flag for 10 seconds under reduced motion', () => {
    vi.useFakeTimers();
    media.setMedia({ reducedMotion: true });
    const { container, rerender } = render(<LineDiagram stations={beforeSync} />);
    rerender(<LineDiagram stations={afterSync} />);
    expect(arriving(container)).toEqual([]);
    const marker = entryBody(container, 'released', 'dark_mode')?.querySelector(
      '[data-changed-marker]',
    );
    expect(marker?.textContent).toBe('Changed');
    expect(container.querySelectorAll('[data-changed-marker]')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(changedMarkerMs - 1);
    });
    expect(container.querySelector('[data-changed-marker]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('[data-changed-marker]')).toBeNull();
  });
});

describe('StripMap', () => {
  it('slides a flag that moved station into its new station', () => {
    const { container, rerender } = render(<StripMap stations={beforeSync} />);
    rerender(<StripMap stations={afterSync} />);
    expect(arriving(container)).toEqual(['dark_mode']);
  });
});

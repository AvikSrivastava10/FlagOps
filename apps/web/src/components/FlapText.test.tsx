import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedMarkerMs } from '../lib/use-change-marker';
import { FlapText, changedPositions, maxFlippedCharacters } from './FlapText';
import { setUpComponentTests } from './test-utils';

const media = setUpComponentTests();

function tiles(container: HTMLElement): string {
  return [...container.querySelectorAll('[aria-hidden="true"] span span')]
    .map((tile) => tile.textContent)
    .join('');
}

function flipping(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('[data-flipping]')];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FlapText', () => {
  it('shows capitals on tiles and reads the text as written', () => {
    const { container } = render(<FlapText text="Rolling out" />);
    expect(tiles(container)).toBe('ROLLING\u00a0OUT');
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('Rolling out');
  });

  it('pads to a fixed number of tiles', () => {
    const { container } = render(<FlapText text="Held" cells={9} />);
    expect(tiles(container)).toHaveLength(9);
  });

  it('does not flip when it mounts with a change key', () => {
    const { container } = render(<FlapText text="Testing" changeKey={4} />);
    expect(flipping(container)).toHaveLength(0);
    expect(container.querySelector('[data-changed-marker]')).toBeNull();
  });

  it('flips at most 8 changed tiles, 45ms apart, on every change', () => {
    const { container, rerender } = render(<FlapText text="Testing" changeKey={1} />);
    rerender(<FlapText text="Ready for removal" changeKey={2} />);
    const first = flipping(container);
    expect(first).toHaveLength(maxFlippedCharacters);
    expect(first.map((tile) => (tile as HTMLElement).style.animationDelay)).toEqual(
      Array.from({ length: 8 }, (_, order) => `calc(var(--flap-step) * ${order})`),
    );

    rerender(<FlapText text="Boarding" changeKey={3} />);
    const second = flipping(container);
    expect(second.length).toBeGreaterThan(0);
    // The tiles remount on each change, so the animation plays again.
    expect(second[0]).not.toBe(first[0]);
  });

  it('counts only the characters that changed', () => {
    expect(changedPositions('READY', 'HELD ')).toEqual([0, 2, 4]);
    expect(changedPositions('DELAYED', 'DEPARTED')).toEqual([2, 4, 5, 6, 7]);
    expect(changedPositions('READY', 'READY')).toEqual([]);
  });

  it('shows the static marker for 10 seconds instead of flipping under reduced motion', () => {
    vi.useFakeTimers();
    media.setMedia({ reducedMotion: true });
    const { container, rerender } = render(<FlapText text="Testing" changeKey={1} />);
    rerender(<FlapText text="Rolling out" changeKey={2} />);
    expect(flipping(container)).toHaveLength(0);
    expect(container.querySelector('[data-changed-marker]')?.textContent).toBe('Changed');

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

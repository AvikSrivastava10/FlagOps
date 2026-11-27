import { describe, expect, it } from 'vitest';
import { placePopover } from './anchored-position';

const viewport = { width: 390, height: 844 };
const card = { width: 300, height: 200 };

describe('placePopover', () => {
  it('goes below the anchor when it fits', () => {
    const anchor = { top: 100, left: 16, width: 180, height: 28 };
    expect(placePopover(anchor, card, viewport)).toEqual({ top: 132, left: 16 });
  });

  it('goes above the anchor when there is no room below, never over it', () => {
    const anchor = { top: 700, left: 16, width: 180, height: 28 };
    const { top } = placePopover(anchor, card, viewport);
    expect(top + card.height).toBeLessThanOrEqual(anchor.top);
  });

  it('stays inside the viewport for an anchor near the right edge', () => {
    const anchor = { top: 100, left: 330, width: 50, height: 20 };
    const { left } = placePopover(anchor, card, viewport);
    expect(left + card.width).toBeLessThanOrEqual(viewport.width);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('starts at the anchor edge when the anchor is scrolled off to the left', () => {
    const anchor = { top: 100, left: -120, width: 180, height: 28 };
    expect(placePopover(anchor, card, viewport).left).toBe(8);
  });
});

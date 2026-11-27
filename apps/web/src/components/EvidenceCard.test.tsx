import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlagEntry, type FlagEntryData } from './FlagEntry';
import { setUpComponentTests } from './test-utils';

setUpComponentTests();

const flag: FlagEntryData = {
  id: '17',
  name: 'new_checkout',
  type: 'release',
  health: ['stuck_rollout'],
  href: '/flags/17',
  zone: 'stale',
  owners: ['@AvikSrivastava10'],
  history: [
    { stage: 'released', since: '2026-11-24' },
    { stage: 'stale', since: '2026-11-27' },
  ],
  evidence: [
    ['ON for everyone in ', { text: '3 of 3 environments', href: '#rows', source: 'Rows' }],
    ['2 references'],
  ],
};

function renderEntry() {
  render(
    <ul>
      <FlagEntry {...flag} />
    </ul>,
  );
  const entry = screen.getByRole('link');
  const card = document.getElementById(entry.getAttribute('aria-describedby') ?? '');
  if (card === null) throw new Error('the entry names no evidence card');
  return { entry, card };
}

describe('EvidenceCard', () => {
  it('describes the entry even while it is closed', () => {
    const { entry, card } = renderEntry();
    expect(card.hidden).toBe(true);
    expect(card.getAttribute('role')).toBe('tooltip');
    expect(card.textContent).toContain('ON for everyone in 3 of 3 environments');
    expect(card.textContent).toContain('@AvikSrivastava10');
    expect(card.textContent).toContain('Flagsmith: stale');
    expect(entry.getAttribute('href')).toBe('/flags/17');
  });

  it('opens on keyboard focus and closes on blur', () => {
    const { entry, card } = renderEntry();
    act(() => {
      entry.focus();
    });
    expect(card.hidden).toBe(false);
    act(() => {
      entry.blur();
    });
    expect(card.hidden).toBe(true);
  });

  it('closes with Escape and keeps focus on the entry', () => {
    const { entry, card } = renderEntry();
    act(() => {
      entry.focus();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card.hidden).toBe(true);
    expect(document.activeElement).toBe(entry);
  });

  it('stays dismissed until hover and focus have both left', () => {
    const { entry, card } = renderEntry();
    act(() => {
      entry.focus();
    });
    fireEvent.mouseEnter(entry);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseLeave(entry);
    expect(card.hidden).toBe(true);
  });

  it('renders the numbers as text, because a description holds no controls', () => {
    const { card } = renderEntry();
    expect(card.querySelector('a')).toBeNull();
  });

  it('opens on hover', () => {
    const { entry, card } = renderEntry();
    fireEvent.mouseEnter(entry);
    expect(card.hidden).toBe(false);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HolidayBanner } from './HolidayBanner';

describe('HolidayBanner', () => {
  it('announces the sale', () => {
    render(<HolidayBanner />);

    expect(screen.getByRole('complementary', { name: 'Holiday sale' }).textContent).toContain(
      '20% off everything',
    );
  });

  it('goes away when the shopper dismisses it', () => {
    render(<HolidayBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

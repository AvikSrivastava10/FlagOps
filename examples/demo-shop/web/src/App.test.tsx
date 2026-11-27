import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../test/flagsmith';
import { App } from './App';

vi.mock('@flagsmith/flagsmith', async () => (await import('../test/flagsmith')).clientModule);
vi.mock('@flagsmith/flagsmith/react', async () => (await import('../test/flagsmith')).reactModule);

describe('App', () => {
  beforeEach(() => {
    serveFlags({
      new_checkout: { enabled: true },
      free_shipping_threshold: { enabled: true, value: 50 },
    });
  });

  it('shows the shop header, the shipping note and the checkout', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Shop');
    expect(screen.getByText('Add $2.00 more for free shipping.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Checkout' })).toBeTruthy();
  });
});

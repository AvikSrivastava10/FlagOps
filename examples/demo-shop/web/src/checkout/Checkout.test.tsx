import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { Checkout } from './Checkout';

vi.mock('@flagsmith/flagsmith/react', async () => (await import('../../test/flagsmith')).reactModule);

const cart = {
  items: [{ sku: 'mug-enamel', name: 'Enamel mug', priceCents: 1200, quantity: 2 }],
};

describe('Checkout', () => {
  beforeEach(() => {
    serveFlags({ new_checkout: { enabled: true } });
  });

  it('shows the one-step checkout with the basket total', () => {
    render(<Checkout cart={cart} />);

    expect(screen.getByText('2 × Enamel mug')).toBeTruthy();
    expect(screen.getByText('$24.00', { selector: 'strong' })).toBeTruthy();
  });

  it('places the order with the saved card', () => {
    render(<Checkout cart={cart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay with saved card' }));

    expect(screen.getByRole('status').textContent).toBe(
      'Order placed. A confirmation email is on its way.',
    );
  });
});

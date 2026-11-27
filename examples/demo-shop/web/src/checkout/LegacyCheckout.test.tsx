import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegacyCheckout } from './LegacyCheckout';

const cart = {
  items: [{ sku: 'mug-enamel', name: 'Enamel mug', priceCents: 1200, quantity: 2 }],
};

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm() {
  fill('Full name', 'Ada Lovelace');
  fill('Street address', '12 Analytical Row');
  fill('City', 'London');
  fill('Postcode', 'N1 9GU');
  fill('Card number', '4242 4242 4242 4242');
  fill('Expiry (MM/YY)', '07/28');
  fill('Security code', '123');
}

describe('LegacyCheckout', () => {
  it('adds flat shipping and 8% tax to the subtotal', () => {
    render(<LegacyCheckout cart={cart} />);

    const amounts = screen.getAllByRole('definition').map((amount) => amount.textContent);
    expect(amounts).toEqual(['$24.00', '$4.99', '$1.92', '$30.91']);
  });

  it('lists every missing field', () => {
    render(<LegacyCheckout cart={cart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByText('Full name is required')).toBeTruthy();
    expect(screen.getByText('Security code is required')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rejects a card number without 16 digits', () => {
    render(<LegacyCheckout cart={cart} />);
    fillValidForm();
    fill('Card number', '4242 4242');
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByText('Card number must have 16 digits')).toBeTruthy();
  });

  it('places the order when every field is valid', () => {
    render(<LegacyCheckout cart={cart} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByRole('status').textContent).toBe('Thank you. Your order is placed.');
  });
});

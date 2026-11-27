import { describe, expect, it } from 'vitest';
import { legacyTotals } from './legacyTotals.ts';

describe('legacyTotals', () => {
  it('adds flat shipping and 8% tax on the subtotal', () => {
    const cart = { items: [{ sku: 'mug-enamel', priceCents: 1200, quantity: 2 }] };

    expect(legacyTotals(cart)).toEqual({
      subtotalCents: 2400,
      shippingCents: 499,
      taxCents: 192,
      totalCents: 3091,
    });
  });

  it('charges the same shipping however large the order is', () => {
    const cart = { items: [{ sku: 'kettle-pour-over', priceCents: 15000, quantity: 3 }] };

    expect(legacyTotals(cart).shippingCents).toBe(499);
  });
});

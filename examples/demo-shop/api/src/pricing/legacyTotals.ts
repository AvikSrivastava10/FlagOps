import { subtotalCents, type Cart, type Totals } from '../cart.ts';

const FLAT_SHIPPING_CENTS = 499;
const TAX_RATE = 0.08;

/** The old checkout's pricing: flat shipping on every order, and tax on the subtotal only. */
export function legacyTotals(cart: Cart): Totals {
  const subtotal = subtotalCents(cart);
  const tax = Math.round(subtotal * TAX_RATE);
  return {
    subtotalCents: subtotal,
    shippingCents: FLAT_SHIPPING_CENTS,
    taxCents: tax,
    totalCents: subtotal + FLAT_SHIPPING_CENTS + tax,
  };
}

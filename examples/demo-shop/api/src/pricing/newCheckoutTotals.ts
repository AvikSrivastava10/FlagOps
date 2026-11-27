import { subtotalCents, type Cart, type Totals } from '../cart.ts';

const SHIPPING_CENTS = 399;
const TAX_RATE = 0.08;

/** The new checkout's pricing: the cheaper carrier's shipping, with tax on goods and shipping. */
export function newCheckoutTotals(cart: Cart): Totals {
  const subtotal = subtotalCents(cart);
  const tax = Math.round((subtotal + SHIPPING_CENTS) * TAX_RATE);
  return {
    subtotalCents: subtotal,
    shippingCents: SHIPPING_CENTS,
    taxCents: tax,
    totalCents: subtotal + SHIPPING_CENTS + tax,
  };
}

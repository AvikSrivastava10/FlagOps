import { useFlags } from '@flagsmith/flagsmith/react';
import type { Cart } from '../cart/cart';
import { LegacyCheckout } from './LegacyCheckout';
import { NewCheckout } from './NewCheckout';

/** The checkout step at the end of the basket. */
export function Checkout({ cart }: { cart: Cart }) {
  const { new_checkout } = useFlags(['new_checkout']);
  return new_checkout.enabled ? <NewCheckout cart={cart} /> : <LegacyCheckout cart={cart} />;
}

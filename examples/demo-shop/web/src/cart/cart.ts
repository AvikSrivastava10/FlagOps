export type CartItem = {
  sku: string;
  name: string;
  priceCents: number;
  quantity: number;
};

export type Cart = { items: CartItem[] };

/** The shopper's basket. The demo starts with two items, just under the free-shipping threshold. */
export const demoCart: Cart = {
  items: [
    { sku: 'mug-enamel', name: 'Enamel mug', priceCents: 1200, quantity: 2 },
    { sku: 'tee-organic', name: 'Organic cotton tee', priceCents: 2400, quantity: 1 },
  ],
};

export function subtotalCents(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatPrice(cents: number): string {
  return dollars.format(cents / 100);
}

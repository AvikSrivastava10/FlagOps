export type CartItem = { sku: string; priceCents: number; quantity: number };

export type Cart = { items: CartItem[] };

export type Totals = {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/** Fastify validates every cart in a request body against this schema before a handler runs. */
export const cartSchema = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['sku', 'priceCents', 'quantity'],
        additionalProperties: false,
        properties: {
          sku: { type: 'string', minLength: 1 },
          priceCents: { type: 'integer', minimum: 0 },
          quantity: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
} as const;

export function subtotalCents(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}

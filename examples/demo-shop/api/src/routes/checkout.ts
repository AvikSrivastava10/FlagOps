import type { FastifyInstance } from 'fastify';
import { cartSchema, type Cart } from '../cart.ts';
import { legacyTotals } from '../pricing/legacyTotals.ts';
import { newCheckoutTotals } from '../pricing/newCheckoutTotals.ts';

export async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Body: Cart }>(
    '/api/checkout/totals',
    { schema: { body: cartSchema } },
    async (request) => {
      const cart = request.body;
      if (request.flags.isFeatureEnabled('new_checkout')) {
        return newCheckoutTotals(cart);
      }
      return legacyTotals(cart);
    },
  );
}

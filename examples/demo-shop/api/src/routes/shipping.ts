import type { FastifyInstance } from 'fastify';

const STANDARD_SHIPPING_CENTS = 499;

type ShippingQuery = { subtotalCents: number };

const shippingQuerySchema = {
  type: 'object',
  required: ['subtotalCents'],
  properties: { subtotalCents: { type: 'integer', minimum: 0 } },
} as const;

export async function shippingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ShippingQuery }>(
    '/api/shipping',
    { schema: { querystring: shippingQuerySchema } },
    async (request) => {
      // The threshold is in dollars; 0 or no value means there is no free shipping.
      const thresholdCents = Number(request.flags.getFeatureValue('free_shipping_threshold')) * 100;
      const free = thresholdCents > 0 && request.query.subtotalCents >= thresholdCents;
      return {
        shippingCents: free ? 0 : STANDARD_SHIPPING_CENTS,
        freeShippingFromCents: thresholdCents > 0 ? thresholdCents : null,
      };
    },
  );
}

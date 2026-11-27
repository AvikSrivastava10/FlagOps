import type { FastifyInstance } from 'fastify';

type Order = { id: string; status: 'processing' | 'shipped'; placedOn: string };

const orders = new Map<string, Order>([
  ['1001', { id: '1001', status: 'shipped', placedOn: '2026-11-20' }],
  ['1002', { id: '1002', status: 'processing', placedOn: '2026-11-26' }],
]);

function liveTracking(order: Order) {
  return { carrier: 'Parcelline', stage: order.status === 'shipped' ? 'in_transit' : 'packing' };
}

export async function orderRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/orders/:id', async (request, reply) => {
    const order = orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send({ error: 'No order has this number.' });
    }
    if (request.flags.isFeatureEnabled('order_tracking_v2')) {
      return { ...order, tracking: liveTracking(order) };
    }
    return order;
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id/tracking', async (request, reply) => {
    if (!request.flags.isFeatureEnabled('order_tracking_v2')) {
      return reply.code(404).send({ error: 'Live tracking is not available yet.' });
    }
    const order = orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send({ error: 'No order has this number.' });
    }
    return liveTracking(order);
  });
}

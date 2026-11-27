import type { FastifyInstance } from 'fastify';

export async function paymentRoutes(app: FastifyInstance) {
  app.post('/api/payments', async (request, reply) => {
    // The kill switch stops new charges at once, for example while the payment provider has an
    // incident.
    if (request.flags.isFeatureEnabled('payments_kill_switch')) {
      return reply
        .code(503)
        .send({ error: 'Payments are paused for a moment. Your card has not been charged.' });
    }
    return reply.code(202).send({ status: 'accepted' });
  });
}

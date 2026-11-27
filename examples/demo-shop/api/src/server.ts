import { fastify, type FastifyServerOptions } from 'fastify';
import { registerFlags } from './flags.ts';
import { adminRoutes } from './routes/admin.ts';
import { checkoutRoutes } from './routes/checkout.ts';
import { orderRoutes } from './routes/orders.ts';
import { paymentRoutes } from './routes/payments.ts';
import { recommendationRoutes } from './routes/recommendations.ts';
import { shippingRoutes } from './routes/shipping.ts';

export function buildServer(options: FastifyServerOptions = {}) {
  const app = fastify(options);
  registerFlags(app);
  app.register(adminRoutes);
  app.register(checkoutRoutes);
  app.register(orderRoutes);
  app.register(paymentRoutes);
  app.register(recommendationRoutes);
  app.register(shippingRoutes);
  return app;
}

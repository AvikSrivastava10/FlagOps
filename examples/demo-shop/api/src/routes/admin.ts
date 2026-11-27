import type { FastifyInstance } from 'fastify';

const salesReports = [
  { id: 'weekly-sales', title: 'Sales this week' },
  { id: 'top-products', title: 'Top products' },
];

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/reports', async (request, reply) => {
    if (!request.flags.isFeatureEnabled('admin_reports')) {
      return reply.code(403).send({ error: 'Sales reports are for staff only.' });
    }
    return { reports: salesReports };
  });
}

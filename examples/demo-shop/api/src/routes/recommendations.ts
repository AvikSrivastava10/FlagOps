import type { FastifyInstance } from 'fastify';

const bestSellers = ['mug-enamel', 'tee-organic', 'tote-canvas'];
const pickedForYou = ['coasters-walnut', 'apron-linen', 'kettle-pour-over'];

export async function recommendationRoutes(app: FastifyInstance) {
  app.get('/api/recommendations', async (request) => {
    // The experiment's variant is the flag's value: "control" or "v2".
    const variant = request.flags.getFeatureValue('recommendations_v2');
    return variant === 'v2'
      ? { variant: 'v2', skus: pickedForYou }
      : { variant: 'control', skus: bestSellers };
  });
}

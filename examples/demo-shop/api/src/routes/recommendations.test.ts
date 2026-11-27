import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

describe('GET /api/recommendations', () => {
  it('recommends the best sellers to the control group', async () => {
    serveFlags({ recommendations_v2: { enabled: false, value: 'control' } });

    const response = await buildServer().inject({ method: 'GET', url: '/api/recommendations' });

    expect(response.json()).toEqual({
      variant: 'control',
      skus: ['mug-enamel', 'tee-organic', 'tote-canvas'],
    });
  });
});

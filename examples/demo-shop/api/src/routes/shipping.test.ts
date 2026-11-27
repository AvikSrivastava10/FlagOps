import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

async function quote(subtotalCents: number) {
  const response = await buildServer().inject({
    method: 'GET',
    url: `/api/shipping?subtotalCents=${subtotalCents}`,
  });
  return response.json<{ shippingCents: number; freeShippingFromCents: number | null }>();
}

describe('GET /api/shipping', () => {
  beforeEach(() => {
    serveFlags({ free_shipping_threshold: { enabled: true, value: 50 } });
  });

  it('charges standard shipping below the threshold', async () => {
    expect(await quote(4999)).toEqual({ shippingCents: 499, freeShippingFromCents: 5000 });
  });

  it('ships free from the threshold up', async () => {
    expect(await quote(5000)).toEqual({ shippingCents: 0, freeShippingFromCents: 5000 });
  });
});

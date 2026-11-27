import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

const cart = { items: [{ sku: 'mug-enamel', priceCents: 1200, quantity: 2 }] };

describe('POST /api/checkout/totals', () => {
  beforeEach(() => {
    serveFlags({ new_checkout: { enabled: true } });
  });

  it("prices the cart with the new checkout's shipping and tax", async () => {
    const response = await buildServer().inject({
      method: 'POST',
      url: '/api/checkout/totals',
      payload: cart,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subtotalCents: 2400,
      shippingCents: 399,
      taxCents: 224,
      totalCents: 3023,
    });
  });

  it('rejects a cart without items', async () => {
    const response = await buildServer().inject({
      method: 'POST',
      url: '/api/checkout/totals',
      payload: { items: [] },
    });

    expect(response.statusCode).toBe(400);
  });
});

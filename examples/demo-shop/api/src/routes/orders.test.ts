import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

describe('orders', () => {
  beforeEach(() => {
    serveFlags({ order_tracking_v2: { enabled: false } });
  });

  it('returns the order with its status', async () => {
    const response = await buildServer().inject({ method: 'GET', url: '/api/orders/1001' });

    expect(response.json()).toEqual({ id: '1001', status: 'shipped', placedOn: '2026-11-20' });
  });

  it('answers 404 for an unknown order', async () => {
    const response = await buildServer().inject({ method: 'GET', url: '/api/orders/9999' });

    expect(response.statusCode).toBe(404);
  });

  it('has no live tracking yet', async () => {
    const response = await buildServer().inject({
      method: 'GET',
      url: '/api/orders/1001/tracking',
    });

    expect(response.statusCode).toBe(404);
  });
});

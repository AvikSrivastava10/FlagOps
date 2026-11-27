import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

describe('POST /api/payments', () => {
  it('accepts payments while the kill switch is off', async () => {
    serveFlags({ payments_kill_switch: { enabled: false } });

    const response = await buildServer().inject({ method: 'POST', url: '/api/payments' });

    expect(response.statusCode).toBe(202);
  });

  it('pauses payments while the kill switch is on', async () => {
    serveFlags({ payments_kill_switch: { enabled: true } });

    const response = await buildServer().inject({ method: 'POST', url: '/api/payments' });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: string }>().error).toContain('not been charged');
  });
});

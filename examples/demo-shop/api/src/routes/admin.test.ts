import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith.ts';
import { buildServer } from '../server.ts';

vi.mock('@flagsmith/nodejs', () => import('../../test/flagsmith.ts'));

describe('GET /api/admin/reports', () => {
  it('lists the sales reports for staff', async () => {
    serveFlags({ admin_reports: { enabled: true } });

    const response = await buildServer().inject({ method: 'GET', url: '/api/admin/reports' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ reports: unknown[] }>().reports).toHaveLength(2);
  });

  it('refuses everyone else', async () => {
    serveFlags({ admin_reports: { enabled: false } });

    const response = await buildServer().inject({ method: 'GET', url: '/api/admin/reports' });

    expect(response.statusCode).toBe(403);
  });
});

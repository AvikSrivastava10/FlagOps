import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityRequests, serveFlags } from '../test/flagsmith.ts';
import { buildServer } from './server.ts';

vi.mock('@flagsmith/nodejs', () => import('../test/flagsmith.ts'));

describe('flags on each request', () => {
  beforeEach(() => {
    serveFlags({});
  });

  it("asks Flagsmith for the signed-in user's flags, sending their traits", async () => {
    await buildServer().inject({
      method: 'GET',
      url: '/api/recommendations',
      headers: { 'x-user-id': 'user-0050', 'x-user-role': 'staff', 'x-user-plan': 'pro' },
    });

    expect(identityRequests).toEqual([
      { identifier: 'user-0050', traits: { role: 'staff', plan: 'pro' } },
    ]);
  });

  it('treats a request without a user as an anonymous customer', async () => {
    await buildServer().inject({ method: 'GET', url: '/api/recommendations' });

    expect(identityRequests).toEqual([
      { identifier: 'anonymous', traits: { role: 'customer', plan: 'free' } },
    ]);
  });
});

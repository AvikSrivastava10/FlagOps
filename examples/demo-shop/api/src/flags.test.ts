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
      { identifier: 'user-0050', traits: { role: 'staff', plan: 'pro' }, transient: true },
    ]);
  });

  it('treats a request without a user as an anonymous customer', async () => {
    await buildServer().inject({ method: 'GET', url: '/api/recommendations' });

    expect(identityRequests).toEqual([
      { identifier: 'anonymous', traits: { role: 'customer', plan: 'free' }, transient: true },
    ]);
  });

  it('never asks Flagsmith to create or change an identity, for anonymous, unknown or seeded users', async () => {
    const server = buildServer();

    await server.inject({ method: 'GET', url: '/api/recommendations' });
    await server.inject({
      method: 'GET',
      url: '/api/recommendations',
      headers: { 'x-user-id': 'visitor-7f3a' },
    });
    await server.inject({
      method: 'GET',
      url: '/api/recommendations',
      headers: { 'x-user-id': 'user-0010' },
    });

    expect(identityRequests.map((request) => request.identifier)).toEqual([
      'anonymous',
      'visitor-7f3a',
      'user-0010',
    ]);
    // Only a call without `transient` creates an identity or stores traits in Flagsmith.
    expect(identityRequests.filter((request) => !request.transient)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { createAttemptLimiter } from './attempt-limiter.js';

describe('createAttemptLimiter', () => {
  it('allows 10 attempts per 5 minutes per client, then names the wait', () => {
    let time = 0;
    const limiter = createAttemptLimiter({ now: () => time });

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(limiter.attempt('10.0.0.1')).toEqual({ allowed: true });
      time += 1000;
    }
    expect(limiter.attempt('10.0.0.1')).toEqual({ allowed: false, retryAfterSeconds: 290 });
    expect(limiter.attempt('10.0.0.2')).toEqual({ allowed: true });
  });

  it('allows attempts again once the oldest leaves the window', () => {
    let time = 0;
    const limiter = createAttemptLimiter({ limit: 2, windowMs: 60_000, now: () => time });

    limiter.attempt('client');
    limiter.attempt('client');
    expect(limiter.attempt('client').allowed).toBe(false);
    time = 60_000;
    expect(limiter.attempt('client').allowed).toBe(true);
  });
});

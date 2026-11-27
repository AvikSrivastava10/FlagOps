import { describe, expect, it } from 'vitest';
import { Secret } from '../config/secret.js';
import { createMfaChallenges, mfaChallengeLifetimeMs } from './mfa.js';
import { createMemorySessionStore, sessionIdleMs, sessionLifetimeMs } from './sessions.js';

const user = { id: 7, email: 'operator@example.com', displayName: 'Operator' };
const credential = { kind: 'user_token' as const, token: new Secret('test-user-token-000001') };
const hour = 60 * 60 * 1000;

describe('createMemorySessionStore', () => {
  function storeAt(start = 0) {
    let time = start;
    const store = createMemorySessionStore(() => time);
    return {
      store,
      advance: (ms: number) => {
        time += ms;
      },
    };
  }

  it('creates sessions with 32 random bytes as their ID', () => {
    const { store } = storeAt();
    const a = store.create({ user, credential });
    const b = store.create({ user, credential });

    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id)).toBe(a);
  });

  it('ends a session after 8 idle hours', () => {
    const { store, advance } = storeAt();
    const session = store.create({ user, credential });

    advance(sessionIdleMs);
    expect(store.get(session.id)).toBe(session);
    advance(sessionIdleMs + 1);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('ends an active session after 24 hours in all', () => {
    const { store, advance } = storeAt();
    const session = store.create({ user, credential });

    for (let elapsed = 0; elapsed < sessionLifetimeMs; elapsed += hour) {
      expect(store.get(session.id)).toBe(session);
      advance(hour);
    }
    advance(1);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('destroys a session on sign-out', () => {
    const { store } = storeAt();
    const session = store.create({ user, credential });

    store.destroy(session.id);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('never shows the Flagsmith credential when a session is serialised', () => {
    const { store } = storeAt();

    expect(JSON.stringify(store.create({ user, credential }))).not.toContain('test-user-token');
  });
});

describe('createMfaChallenges', () => {
  it('closes a challenge after 5 minutes', () => {
    let time = 0;
    const challenges = createMfaChallenges(() => time);
    const challenge = challenges.create(new Secret('ephemeral-token'));

    time = mfaChallengeLifetimeMs;
    expect(challenges.get(challenge.id)).toBe(challenge);
    time += 1;
    expect(challenges.get(challenge.id)).toBeUndefined();
  });

  it('closes a challenge after 5 wrong codes', () => {
    const challenges = createMfaChallenges(() => 0);
    const challenge = challenges.create(new Secret('ephemeral-token'));

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      challenges.recordFailure(challenge.id);
      expect(challenges.get(challenge.id)).toBe(challenge);
    }
    challenges.recordFailure(challenge.id);
    expect(challenges.get(challenge.id)).toBeUndefined();
  });
});

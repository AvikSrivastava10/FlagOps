import { describe, expect, it } from 'vitest';
import { mapConcurrently } from './concurrency.js';

describe('mapConcurrently', () => {
  it('returns the results in the order of the items, with at most `limit` tasks at once', async () => {
    let running = 0;
    let most = 0;

    const results = await mapConcurrently([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(most).toBe(2);
  });

  it('starts no task after one has failed, and lets the running ones finish', async () => {
    const started: number[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const call = mapConcurrently([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      if (item === 0) {
        throw new Error('item 0 failed');
      }
      await gate;
      return item;
    });

    await expect(call).rejects.toThrow('item 0 failed');
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual([0, 1]);
  });
});

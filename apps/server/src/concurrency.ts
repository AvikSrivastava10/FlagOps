/**
 * Runs `task` for every item with at most `limit` running at once, and returns the results in the
 * items' order. FlagOps uses it to stay within 6 concurrent Flagsmith requests (architecture.md 6.4).
 * The first failure rejects the whole call. No task starts after it; tasks already running are
 * left to finish.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        // The index is in range: `next` only grows while it is below items.length.
        results[index] = await task(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

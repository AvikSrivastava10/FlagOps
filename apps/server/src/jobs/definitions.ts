import type { InventorySync } from '../inventory/sync.js';
import type { JobDefinition } from './scheduler.js';

/** The background jobs of architecture.md 17 that exist so far. */

/** `sync`: at start, every `FLAGOPS_SYNC_INTERVAL_SECONDS`, and on `POST /api/sync`. */
export function syncJob(sync: InventorySync, intervalSeconds: number): JobDefinition {
  return {
    name: 'sync',
    intervalMs: intervalSeconds * 1000,
    run: async () => {
      await sync.run();
    },
  };
}

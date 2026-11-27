import type { InventorySync } from '../inventory/sync.js';
import type { ScanService } from '../scanner/scan.js';
import type { JobDefinition } from './scheduler.js';

/** The background jobs of architecture.md 17 that exist so far. */

/**
 * `sync`: at start, every `FLAGOPS_SYNC_INTERVAL_SECONDS`, and on `POST /api/sync`. After a
 * successful sync, `afterSync` starts the jobs that depend on the inventory, such as the scan.
 */
export function syncJob(
  sync: InventorySync,
  intervalSeconds: number,
  afterSync: () => void = () => undefined,
): JobDefinition {
  return {
    name: 'sync',
    intervalMs: intervalSeconds * 1000,
    run: async () => {
      await sync.run();
      afterSync();
    },
  };
}

/**
 * `scan`: after each successful sync and on `POST /api/scans` (architecture.md 8.5, 17), with no
 * interval of its own. The sync requests every tracked repository, so each one gets one head
 * check per sync interval (7.3), and a new commit is scanned within one interval.
 */
export function scanJob(scans: ScanService): JobDefinition {
  return { name: 'scan', run: () => scans.run() };
}

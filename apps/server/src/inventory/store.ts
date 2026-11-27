import type { ErrorCode } from '@flagops/shared';
import type { Inventory } from './types.js';

export type SyncFailure = { at: string; code: ErrorCode; message: string };

/**
 * Holds the latest inventory. A sync replaces it in one step, and a failed sync leaves the previous
 * one in place, so readers never see partial data (features.md S1.4).
 */
export type InventoryStore = {
  current(): Inventory | undefined;
  /** The failure of the latest sync, until a sync succeeds. */
  lastFailure(): SyncFailure | undefined;
  replace(inventory: Inventory): void;
  recordFailure(failure: SyncFailure): void;
};

export function createInventoryStore(): InventoryStore {
  let inventory: Inventory | undefined;
  let failure: SyncFailure | undefined;
  return {
    current: () => inventory,
    lastFailure: () => failure,
    replace(next) {
      inventory = next;
      failure = undefined;
    },
    recordFailure(next) {
      failure = next;
    },
  };
}

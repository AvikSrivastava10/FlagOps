import type { FlagConfig } from '@flagops/shared';
import type { FlagopsFieldName } from '../flagsmith/metadata.js';

/**
 * FlagOps' picture of the managed Flagsmith project, rebuilt on every sync and kept in memory
 * (architecture.md 6.4, 16). Stage rules, drift and the screens read it; nothing writes to it.
 */
export type Inventory = {
  syncedAt: string;
  /** The `Flagsmith-Version` the sync's responses announced. */
  flagsmithVersion: string | undefined;
  organisation: { id: number; name: string };
  project: {
    id: number;
    name: string;
    hideDisabledFlags: boolean;
    staleFlagsLimitDays: number;
  };
  /** In Flagsmith's order, ascending ID. */
  environments: InventoryEnvironment[];
  segments: { id: number; name: string; managedBy: string }[];
  tags: { id: number; label: string; isPermanent: boolean }[];
  flags: InventoryFlag[];
};

export type InventoryEnvironment = {
  id: number;
  name: string;
  /** The client key, public by design; dashboard links and the flag API use it. */
  apiKey: string;
  v2Versioning: boolean;
  /** `minimum_change_request_approvals` is set, 0 included (architecture.md 6.5). */
  changeRequestsBlockWrites: boolean;
  /** The environment's `hide_disabled_flags`, else the project's. */
  hideDisabledFlags: boolean;
};

export type InventoryFlag = {
  id: number;
  name: string;
  description: string;
  createdDate: string;
  isArchived: boolean;
  /** Flagsmith never sends these flags to client-side keys (architecture.md 6.5). */
  isServerKeyOnly: boolean;
  tagIds: number[];
  owners: { id: number; email: string }[];
  groupOwners: { id: number; name: string }[];
  /** The raw values of FlagOps' metadata fields; they are validated where they are used. */
  metadata: Record<FlagopsFieldName, string | null>;
  /** The newest published v2 version; null without v2 versioning. */
  lastModifiedInAnyEnvironment: string | null;
  codeReferenceCounts: { repositoryUrl: string; count: number }[];
  /** Per environment ID. */
  environments: Record<number, InventoryFlagEnvironment>;
};

export type InventoryFlagEnvironment = {
  /** Null when the environment's document has no feature state for the flag. */
  config: FlagConfig | null;
  /** `num_segment_overrides`, which counts system segments too. */
  segmentOverrideCount: number;
  identityOverrideCount: number;
  /** Flagsmith's own lifecycle stage for the flag in this environment. */
  flagsmithLifecycleStage: string | null;
};

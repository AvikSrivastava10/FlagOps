import { FlagOpsError, type ErrorCode } from '@flagops/shared';
import type { Logger } from 'pino';
import { appendAudit } from '../audit/audit.js';
import type { Db } from '../db/connection.js';
import {
  forgetAddedOwners,
  listAddedOwners,
  listOwnerMappings,
  recordAddedOwners,
  type AddedOwner,
} from '../db/repos/owners.js';
import type { FlagsmithClient } from '../flagsmith/client.js';
import type { FlagsmithCredential } from '../flagsmith/credentials.js';
import { listFeatures } from '../flagsmith/features.js';
import { changeOwners, type OwnerChange } from '../flagsmith/owners.js';
import type { OwnerEvidence } from './derive.js';

/**
 * Owner sync (architecture.md 8.5, step 3), with the organisation key: each flag gets the mapped
 * Flagsmith users and groups of its CODEOWNERS owners. FlagOps removes only the owners it added
 * itself, and every change is audited. A failure on one flag does not stop the others (18.2); the
 * report lists it, and the syncer decides whether the next run repeats it and when to warn.
 */
export type OwnerSyncDeps = {
  db: Db;
  client: FlagsmithClient;
  credential: FlagsmithCredential;
  logger: Logger;
};

export type OwnerSyncReport = {
  added: number;
  removed: number;
  failures: { flag: string; code: ErrorCode; message: string }[];
};

/** `@Name` and `name` are the same GitHub handle. */
export function handleKey(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

type Plan = { featureId: number; flag: string; changes: OwnerChange[] };

function difference(a: readonly number[], b: readonly number[]): number[] {
  return a.filter((id) => !b.includes(id));
}

export async function syncOwners(
  deps: OwnerSyncDeps,
  projectId: number,
  derived: ReadonlyMap<string, readonly OwnerEvidence[]>,
): Promise<OwnerSyncReport> {
  const mappings = new Map(
    listOwnerMappings(deps.db).map((mapping) => [handleKey(mapping.github), mapping]),
  );
  const added = listAddedOwners(deps.db);
  const features = await listFeatures(deps.client, deps.credential, projectId, undefined);
  const plans: Plan[] = features.map((feature) => {
    const evidence = derived.get(feature.name) ?? [];
    const mapped = evidence.map((item) => mappings.get(handleKey(item.owner.handle)));
    const wantedUsers = [
      ...new Set(mapped.flatMap((m) => (m?.kind === 'user' ? [m.flagsmithUserId] : []))),
    ];
    const wantedGroups = [
      ...new Set(mapped.flatMap((m) => (m?.kind === 'team' ? [m.flagsmithGroupId] : []))),
    ];
    const users = feature.owners.map((owner) => owner.id);
    const groups = feature.group_owners.map((owner) => owner.id);
    const ours = (kind: AddedOwner['kind']) =>
      added
        .filter((owner) => owner.featureId === feature.id && owner.kind === kind)
        .map((owner) => owner.flagsmithId);
    const changes: OwnerChange[] = [
      { kind: 'user', action: 'add', ids: difference(wantedUsers, users) },
      { kind: 'group', action: 'add', ids: difference(wantedGroups, groups) },
      { kind: 'user', action: 'remove', ids: difference(ours('user'), wantedUsers) },
      { kind: 'group', action: 'remove', ids: difference(ours('group'), wantedGroups) },
    ];
    return {
      featureId: feature.id,
      flag: feature.name,
      changes: changes.filter((change) => change.ids.length > 0),
    };
  });
  const report: OwnerSyncReport = { added: 0, removed: 0, failures: [] };
  for (const plan of plans) {
    for (const change of plan.changes) {
      await apply(deps, projectId, plan, change, report);
    }
  }
  return report;
}

async function apply(
  deps: OwnerSyncDeps,
  projectId: number,
  plan: Plan,
  change: OwnerChange,
  report: OwnerSyncReport,
): Promise<void> {
  const owners = change.ids.map((flagsmithId) => ({
    featureId: plan.featureId,
    kind: change.kind,
    flagsmithId,
  }));
  const audit = (outcome: 'succeeded' | 'failed', errorMessage?: string) => {
    appendAudit(deps.db, {
      actor: { kind: 'system' },
      action: change.action === 'add' ? 'owners.add' : 'owners.remove',
      outcome,
      featureId: plan.featureId,
      featureName: plan.flag,
      details: { kind: change.kind, ids: change.ids },
      ...(errorMessage === undefined ? {} : { errorMessage }),
    });
  };
  try {
    await changeOwners(
      deps.client,
      deps.credential,
      { projectId, featureId: plan.featureId },
      change,
    );
  } catch (error) {
    if (!(error instanceof FlagOpsError)) {
      throw error;
    }
    audit('failed', error.message);
    report.failures.push({ flag: plan.flag, code: error.code, message: error.message });
    return;
  }
  if (change.action === 'add') {
    recordAddedOwners(deps.db, owners);
    report.added += owners.length;
  } else {
    forgetAddedOwners(deps.db, owners);
    report.removed += owners.length;
  }
  audit('succeeded');
  deps.logger.info(
    { flag: plan.flag, kind: change.kind, ids: change.ids },
    `${change.action === 'add' ? 'Added' : 'Removed'} ${change.ids.length} ${change.kind} owners of ${plan.flag}`,
  );
}

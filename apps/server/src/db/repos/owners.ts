import type { Db } from '../connection.js';

/**
 * Owner mappings, set by the operator, and the owners FlagOps added to flags in Flagsmith
 * (architecture.md 8.5, 16).
 */
export type OwnerMapping =
  | { github: string; kind: 'user'; flagsmithUserId: number }
  | { github: string; kind: 'team'; flagsmithGroupId: number };

type MappingRow = {
  github: string;
  kind: 'user' | 'team';
  flagsmith_user_id: number | null;
  flagsmith_group_id: number | null;
};

export function listOwnerMappings(db: Db): OwnerMapping[] {
  return db
    .prepare<[], MappingRow>(
      'SELECT github, kind, flagsmith_user_id, flagsmith_group_id FROM owner_mappings ORDER BY github',
    )
    .all()
    .map((row) =>
      row.kind === 'user'
        ? { github: row.github, kind: 'user', flagsmithUserId: row.flagsmith_user_id ?? 0 }
        : { github: row.github, kind: 'team', flagsmithGroupId: row.flagsmith_group_id ?? 0 },
    );
}

/** Replaces every mapping in one transaction. */
export function replaceOwnerMappings(
  db: Db,
  mappings: readonly OwnerMapping[],
  now = new Date(),
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM owner_mappings').run();
    const insert = db.prepare(
      'INSERT INTO owner_mappings (github, kind, flagsmith_user_id, flagsmith_group_id, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const mapping of mappings) {
      insert.run(
        mapping.github,
        mapping.kind,
        mapping.kind === 'user' ? mapping.flagsmithUserId : null,
        mapping.kind === 'team' ? mapping.flagsmithGroupId : null,
        now.toISOString(),
      );
    }
  })();
}

export type AddedOwner = { featureId: number; kind: 'user' | 'group'; flagsmithId: number };

export function listAddedOwners(db: Db): AddedOwner[] {
  return db
    .prepare<[], { feature_id: number; kind: 'user' | 'group'; flagsmith_id: number }>(
      'SELECT feature_id, kind, flagsmith_id FROM owner_sync ORDER BY feature_id, kind, flagsmith_id',
    )
    .all()
    .map((row) => ({ featureId: row.feature_id, kind: row.kind, flagsmithId: row.flagsmith_id }));
}

export function recordAddedOwners(db: Db, owners: readonly AddedOwner[], now = new Date()): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO owner_sync (feature_id, kind, flagsmith_id, added_at) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const owner of owners) {
      insert.run(owner.featureId, owner.kind, owner.flagsmithId, now.toISOString());
    }
  })();
}

export function forgetAddedOwners(db: Db, owners: readonly AddedOwner[]): void {
  const remove = db.prepare(
    'DELETE FROM owner_sync WHERE feature_id = ? AND kind = ? AND flagsmith_id = ?',
  );
  db.transaction(() => {
    for (const owner of owners) {
      remove.run(owner.featureId, owner.kind, owner.flagsmithId);
    }
  })();
}

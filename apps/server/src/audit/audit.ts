import type { Db } from '../db/connection.js';

/** Who acted: a signed-in Flagsmith user, or FlagOps itself (a background job or the seed). */
export type AuditActor = { kind: 'user'; userId: number; email: string } | { kind: 'system' };

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  outcome: 'succeeded' | 'failed';
  featureId?: number;
  featureName?: string;
  target?: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
};

/**
 * Appends one entry to FlagOps' audit log (features.md X4). The log is append-only: no statement
 * updates or deletes its rows.
 */
export function appendAudit(db: Db, entry: AuditEntry, at = new Date()): void {
  db.prepare(
    `INSERT INTO audit_log (at, actor_kind, actor_user_id, actor_email, action, feature_id,
       feature_name, target, outcome, details_json, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    at.toISOString(),
    entry.actor.kind,
    entry.actor.kind === 'user' ? entry.actor.userId : null,
    entry.actor.kind === 'user' ? entry.actor.email : null,
    entry.action,
    entry.featureId ?? null,
    entry.featureName ?? null,
    entry.target ?? null,
    entry.outcome,
    entry.details === undefined ? null : JSON.stringify(entry.details),
    entry.errorMessage ?? null,
  );
}

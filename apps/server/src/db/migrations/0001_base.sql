-- FlagOps' own state (architecture.md 16). Timestamps are ISO-8601 UTC strings.

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  error_code TEXT,
  error_message TEXT,
  details_json TEXT
) STRICT;

-- Append-only: FlagOps has no UPDATE or DELETE statement for this table.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'system')),
  actor_user_id INTEGER,
  actor_email TEXT,
  action TEXT NOT NULL,
  feature_id INTEGER,
  feature_name TEXT,
  target TEXT,
  outcome TEXT NOT NULL,
  details_json TEXT,
  error_message TEXT
) STRICT;

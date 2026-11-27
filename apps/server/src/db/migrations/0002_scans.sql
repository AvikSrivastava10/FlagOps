-- Repository scans, their records, and ownership (architecture.md 8 and 16).

CREATE TABLE scans (
  id INTEGER PRIMARY KEY,
  repository TEXT NOT NULL,
  commit_sha TEXT,
  flag_names_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  files_scanned INTEGER NOT NULL DEFAULT 0,
  files_skipped_json TEXT NOT NULL DEFAULT '[]',
  accessor_problems_json TEXT NOT NULL DEFAULT '[]',
  codeowners_path TEXT,
  codeowners_text TEXT,
  codeowners_errors_json TEXT NOT NULL DEFAULT '[]',
  uploaded_at TEXT,
  upload_error_code TEXT,
  error_code TEXT,
  error_message TEXT
) STRICT;

CREATE INDEX scans_by_repository ON scans (repository, id);

CREATE TABLE code_refs (
  scan_id INTEGER NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('reference', 'test_reference', 'unresolved_name', 'ambiguous_name', 'dynamic',
             'unattributed', 'mention', 'test_mention')
  ),
  flag_name TEXT,
  literal TEXT,
  product TEXT CHECK (product IN ('node', 'client', 'react')),
  rule_id TEXT NOT NULL,
  method TEXT,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  traced INTEGER NOT NULL CHECK (traced IN (0, 1)),
  evidence TEXT NOT NULL,
  snippet TEXT NOT NULL,
  suggestion TEXT
) STRICT;

CREATE INDEX code_refs_by_scan ON code_refs (scan_id, kind, flag_name);

-- How CODEOWNERS owners map to Flagsmith users and groups, set by the operator.
CREATE TABLE owner_mappings (
  github TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'team')),
  flagsmith_user_id INTEGER,
  flagsmith_group_id INTEGER,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'user') = (flagsmith_user_id IS NOT NULL)),
  CHECK ((kind = 'team') = (flagsmith_group_id IS NOT NULL))
) STRICT;

-- The owners FlagOps added to a flag in Flagsmith: the only ones it ever removes.
CREATE TABLE owner_sync (
  feature_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'group')),
  flagsmith_id INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (feature_id, kind, flagsmith_id)
) STRICT;

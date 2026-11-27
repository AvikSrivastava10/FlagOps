import { readdirSync, readFileSync } from 'node:fs';
import type { Db } from './connection.js';

const fileNamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;

type Migration = { version: number; name: string; sql: string };

function readMigrations(directory: URL): Migration[] {
  const versions = new Set<number>();
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .map((name): Migration => {
      const digits = fileNamePattern.exec(name)?.[1];
      if (digits === undefined) {
        throw new Error(`Migration ${name} is not named NNNN_name.sql`);
      }
      const version = Number(digits);
      if (versions.has(version)) {
        throw new Error(`Two migrations have version ${version}`);
      }
      versions.add(version);
      return { version, name, sql: readFileSync(new URL(name, directory), 'utf8') };
    })
    .sort((a, b) => a.version - b.version);
}

function appliedVersions(db: Db): Set<number> {
  // Migration 0001 creates schema_migrations, so a new database has no such table yet.
  const tracked = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (tracked === undefined) {
    return new Set();
  }
  return new Set(db.prepare<[], number>('SELECT version FROM schema_migrations').pluck().all());
}

/**
 * Applies the migrations in `directory` that the database has not seen, in version order, each in
 * its own transaction together with its `schema_migrations` row. Returns the applied file names.
 */
export function migrate(db: Db, directory = new URL('./migrations/', import.meta.url)): string[] {
  const applied = appliedVersions(db);
  const appliedNow: string[] = [];
  for (const migration of readMigrations(directory)) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
    })();
    appliedNow.push(migration.name);
  }
  return appliedNow;
}

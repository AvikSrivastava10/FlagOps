import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../config/load.js';
import { openDatabase, type Db } from './connection.js';
import { migrate } from './migrate.js';

let workDir: string;
let db: Db | undefined;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'flagops-db-'));
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(workDir, { recursive: true, force: true });
});

function tableNames(database: Db): string[] {
  return database
    .prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .pluck()
    .all();
}

function migrationsDir(files: Record<string, string>): URL {
  const dir = path.join(workDir, 'migrations');
  mkdirSync(dir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), sql);
  }
  return pathToFileURL(dir + path.sep);
}

describe('migrate', () => {
  it('applies the migrations in order, once, and records them', () => {
    db = new Database(':memory:');

    expect(migrate(db)).toEqual(['0001_base.sql', '0002_scans.sql']);
    expect(tableNames(db)).toEqual([
      'audit_log',
      'code_refs',
      'job_runs',
      'owner_mappings',
      'owner_sync',
      'scans',
      'schema_migrations',
      'settings',
    ]);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare<[], number>('SELECT version FROM schema_migrations').pluck().all()).toEqual([
      1, 2,
    ]);
  });

  it('rolls back a failing migration together with its record', () => {
    db = new Database(':memory:');
    const dir = migrationsDir({
      '0001_start.sql':
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
      '0002_broken.sql': 'CREATE TABLE half_done (id INTEGER); INSERT INTO missing VALUES (1);',
    });

    expect(() => migrate(db!, dir)).toThrow(/no such table: missing/);
    expect(tableNames(db)).toEqual(['schema_migrations']);
    expect(db.prepare<[], number>('SELECT version FROM schema_migrations').pluck().all()).toEqual([
      1,
    ]);
  });

  it('refuses a migration file that is not named NNNN_name.sql', () => {
    db = new Database(':memory:');
    const dir = migrationsDir({ 'add-table.sql': 'CREATE TABLE x (id INTEGER);' });

    expect(() => migrate(db!, dir)).toThrow('Migration add-table.sql is not named NNNN_name.sql');
    expect(tableNames(db)).toEqual([]);
  });
});

describe('openDatabase', () => {
  it('creates the data directory and opens flagops.db with the documented settings', () => {
    const dataDir = path.join(workDir, 'nested', 'data');
    db = openDatabase(dataDir);

    expect(db.name).toBe(path.join(dataDir, 'flagops.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('reports a data directory it cannot use as a FLAGOPS_DATA_DIR problem', () => {
    const notADirectory = path.join(workDir, 'file');
    writeFileSync(notADirectory, '');

    expect(() => openDatabase(notADirectory)).toThrow(ConfigError);
    expect(() => openDatabase(notADirectory)).toThrow(/^FLAGOPS_DATA_DIR .*file cannot hold/);
  });
});

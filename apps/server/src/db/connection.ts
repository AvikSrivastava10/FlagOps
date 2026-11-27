import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ConfigError } from '../config/load.js';

export type Db = Database.Database;

/**
 * Opens `flagops.db` in the data directory, creating the directory when needed, with the settings
 * of architecture.md 16. A directory FlagOps cannot use is a configuration problem.
 */
export function openDatabase(dataDir: string): Db {
  let db: Db | undefined;
  try {
    mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'flagops.db'));
    db.pragma('journal_mode = WAL');
  } catch (error) {
    db?.close();
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError([
      `FLAGOPS_DATA_DIR ${dataDir} cannot hold the FlagOps database: ${reason}`,
    ]);
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

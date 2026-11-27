import { flagTypes } from '@flagops/shared';
import { z } from 'zod';
import type { Db } from '../connection.js';

/** The settings FlagOps stores, each with the shape of its value (architecture.md 16). */
const settingSchemas = {
  /** The IDs of FlagOps' own `type:` tags (architecture.md 5.7). */
  type_tag_ids: z.partialRecord(z.enum(flagTypes), z.number().int()),
};

export type SettingKey = keyof typeof settingSchemas;

export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

/** The stored value, or undefined when it is unset or no longer has the expected shape. */
export function readSetting<K extends SettingKey>(db: Db, key: K): SettingValue<K> | undefined {
  const row = db
    .prepare<[string], { value_json: string }>('SELECT value_json FROM settings WHERE key = ?')
    .get(key);
  if (row === undefined) {
    return undefined;
  }
  const parsed = settingSchemas[key].safeParse(JSON.parse(row.value_json));
  return parsed.success ? parsed.data : undefined;
}

export function writeSetting<K extends SettingKey>(
  db: Db,
  key: K,
  value: SettingValue<K>,
  now = new Date(),
): void {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now.toISOString());
}

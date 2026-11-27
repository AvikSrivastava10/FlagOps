import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClient, organisationKey } from '../../test/helpers/flagsmith-client.js';
import type { AuditActor } from '../audit/audit.js';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { listOwnerMappings, type OwnerMapping } from '../db/repos/owners.js';
import { keyOrganisationResolver } from '../flagsmith/projects.js';
import { saveOwnerMappings, type OwnerMappingDeps } from './mappings.js';

// saveOwnerMappings against the fake Flagsmith's organisation directory (architecture.md 15).

const operator: AuditActor = { kind: 'user', userId: 7, email: 'operator@example.com' };
const saved: OwnerMapping[] = [
  { github: '@AvikSrivastava10', kind: 'user', flagsmithUserId: 7 },
  { github: '@acme/platform', kind: 'team', flagsmithGroupId: 3 },
];
let dataDir: string;
let db: Db;
let deps: OwnerMappingDeps;

beforeEach(async () => {
  const { fake, client } = fakeClient();
  fake.state.users.push({
    id: 7,
    email: 'operator@example.com',
    password: 'not used',
    firstName: 'Demo',
    lastName: 'Operator',
    roles: { 1: 'ADMIN' },
  });
  fake.state.groups.push({ id: 3, organisation: 1, name: 'platform' });
  dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-mappings-'));
  db = openDatabase(dataDir);
  migrate(db);
  deps = {
    db,
    client,
    credential: organisationKey,
    keyOrganisation: keyOrganisationResolver(client, organisationKey),
  };
  await saveOwnerMappings(deps, saved, operator);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function auditedSaves(): number {
  return db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'owner_mappings.save'",
    )
    .get()!.count;
}

async function refusalOf(mappings: OwnerMapping[]): Promise<FlagOpsError> {
  const error: unknown = await saveOwnerMappings(deps, mappings, operator).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof FlagOpsError)) {
    throw new Error(`expected a FlagOpsError, got ${String(error)}`);
  }
  return error;
}

describe('saveOwnerMappings', () => {
  it('saves mappings to users and groups the organisation has, and audits the save', () => {
    expect(listOwnerMappings(db)).toEqual(saved);
    expect(auditedSaves()).toBe(1);
  });

  it.each<[string, OwnerMapping[], string]>([
    [
      'a handle mapped twice, in different case',
      [
        { github: '@AvikSrivastava10', kind: 'user', flagsmithUserId: 7 },
        { github: 'aviksrivastava10', kind: 'user', flagsmithUserId: 7 },
      ],
      '@aviksrivastava10 is mapped more than once.',
    ],
    [
      'a user the organisation does not have',
      [{ github: '@someone', kind: 'user', flagsmithUserId: 99 }],
      '@someone maps to Flagsmith user 99, which the organisation does not have.',
    ],
    [
      'a group the organisation does not have',
      [{ github: '@acme/web', kind: 'team', flagsmithGroupId: 42 }],
      '@acme/web maps to Flagsmith group 42, which the organisation does not have.',
    ],
  ])('refuses %s with validation_failed and saves nothing', async (_case, mappings, message) => {
    const error = await refusalOf(mappings);

    expect(error.code).toBe('validation_failed');
    expect(error.message).toBe(message);
    expect(listOwnerMappings(db)).toEqual(saved);
    expect(auditedSaves()).toBe(1);
  });
});

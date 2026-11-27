import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * Fixtures are committed, so none may contain a configured secret (testing.md section 1). The
 * values come from the environment and the local `.env`; in CI, where neither holds them, there
 * is nothing to find.
 */
const secretNames = [
  'FLAGSMITH_ORG_API_KEY',
  'GITHUB_TOKEN',
  'E2E_FLAGSMITH_EMAIL',
  'E2E_FLAGSMITH_PASSWORD',
];

function configuredSecrets(): string[] {
  const envFile = new URL('../../../.env', import.meta.url);
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  return secretNames
    .map((name) => process.env[name] ?? fromFile[name] ?? '')
    .filter((value) => value.trim().length >= 8);
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

describe('fixtures', () => {
  it('contain no configured secret', () => {
    const fixtures = filesUnder(fileURLToPath(new URL('./fixtures/', import.meta.url)));
    const secrets = configuredSecrets();

    const leaking = fixtures.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return secrets.some((secret) => text.includes(secret));
    });

    expect(fixtures.length).toBeGreaterThan(0);
    expect(leaking.map((file) => path.basename(file))).toEqual([]);
  });
});

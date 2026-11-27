import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  importFlagsmithEngine,
  importSdkDocumentMapper,
  loadFlagsmithEngine,
  PINNED_SDK_VERSION,
} from './flagsmith-internals.js';

const packageRoots: string[] = [];

/** A directory that looks like an installed @flagsmith/nodejs of the given version. */
function packageWith(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'flagops-sdk-'));
  packageRoots.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  return root;
}

afterEach(() => {
  for (const root of packageRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the engine loader', () => {
  it('loads getEvaluationResult from the installed @flagsmith/nodejs 9.5.0, once', async () => {
    const engine = await loadFlagsmithEngine();

    expect(PINNED_SDK_VERSION).toBe('9.5.0');
    expect(engine.version).toBe('9.5.0');
    expect(loadFlagsmithEngine()).toBe(loadFlagsmithEngine());
    const result = engine.getEvaluationResult({
      environment: { key: 'env', name: 'Production' },
      features: { banner: { key: '1', name: 'banner', enabled: true, value: 'on' } },
    });
    expect(result.flags['banner']).toMatchObject({ enabled: true, value: 'on', reason: 'STATIC' });
  });

  it.each(['9.5.1', '9.4.0', '10.0.0'])('refuses @flagsmith/nodejs %s', async (version) => {
    const root = packageWith({ name: '@flagsmith/nodejs', version });

    const refusal = `@flagsmith/nodejs ${version} is installed, but the impact preview is verified with 9.5.0 only.`;
    await expect(importFlagsmithEngine(root)).rejects.toThrow(refusal);
    await expect(importSdkDocumentMapper(root)).rejects.toThrow(refusal);
    await expect(importFlagsmithEngine(root)).rejects.toBeInstanceOf(FlagOpsError);
  });

  it('refuses a package that does not declare its version', async () => {
    const root = packageWith({ name: '@flagsmith/nodejs' });

    await expect(importFlagsmithEngine(root)).rejects.toThrow(
      '@flagsmith/nodejs an unknown version is installed',
    );
  });
});

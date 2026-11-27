import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readDemoShopFiles } from '../../src/cli/demo-publish.js';
import { Secret } from '../../src/config/secret.js';
import { openDatabase, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { latestSuccessfulScan, scanRecords } from '../../src/db/repos/scans.js';
import { parseResponse } from '../../src/flagsmith/client.js';
import { authHeaders } from '../../src/flagsmith/credentials.js';
import { listFeatures, type ListedFeature } from '../../src/flagsmith/features.js';
import { keyOrganisationResolver } from '../../src/flagsmith/projects.js';
import { createGitHubClient } from '../../src/github/client.js';
import type { Inventory } from '../../src/inventory/types.js';
import { createInventoryStore } from '../../src/inventory/store.js';
import { createInventorySync } from '../../src/inventory/sync.js';
import { createLogger } from '../../src/logger.js';
import type { CodeRecord } from '../../src/matcher/records.js';
import {
  readDirectory,
  saveOwnerMappings,
  type OwnerMappingDeps,
} from '../../src/ownership/mappings.js';
import { createScanService, type ScanService } from '../../src/scanner/scan.js';
import { FakeGitHub } from '../helpers/fake-github.js';
import { captureLogs } from '../helpers/log-capture.js';
import { liveClient, liveOrganisationKey, skipReason } from '../helpers/live.js';

/**
 * Stage 4 against the seeded demo organisation: the Code References upload (plan S4.2) and the
 * owner sync (S4.4). DEMO_REPO is not published yet (D-087), so the fake GitHub serves the demo
 * shop's tarball, built from examples/demo-shop, under DEMO_REPO's name. The upload and the owner
 * writes go to the live Flagsmith and stay there, as a real scan leaves them; the first live scan
 * of DEMO_REPO replaces the upload with the published commit.
 */
const skip = skipReason('FLAGSMITH_URL', 'FLAGSMITH_ORG_API_KEY', 'DEMO_REPO');

const referencesSchema = z.array(
  z.object({
    repository_url: z.string(),
    revision: z.string(),
    code_references: z.array(
      z.object({ feature_name: z.string(), file_path: z.string(), line_number: z.number() }),
    ),
  }),
);

const lifecycleCountsSchema = z.object({
  new: z.number(),
  live: z.number(),
  stale: z.number(),
  permanent: z.number(),
  needs_monitoring: z.number(),
  to_remove: z.number(),
});

describe.skipIf(skip !== undefined)(
  `scanning, Code References and owners, live${skip === undefined ? '' : ` (${skip})`}`,
  () => {
    const repository = process.env.DEMO_REPO ?? '';
    const repositoryUrl = `https://github.com/${repository}`;
    const client = liveClient();
    const credential = liveOrganisationKey();
    const keyOrganisation = keyOrganisationResolver(client, credential);
    const store = createInventoryStore();
    const logger = createLogger('error', captureLogs().destination);
    let ownerDeps: OwnerMappingDeps;
    let github: FakeGitHub;
    let dataDir: string;
    let db: Db;
    let scans: ScanService;
    let inventory: Inventory;
    let references: CodeRecord[];

    beforeAll(async () => {
      inventory = await createInventorySync({
        client,
        credential,
        keyOrganisation,
        projectId: undefined,
        store,
        logger,
      }).run();
      github = await FakeGitHub.start();
      github.addRepository(repository, {
        files: Object.fromEntries(
          (await readDemoShopFiles()).map((file) => [file.path, file.content]),
        ),
      });
      dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-scan-live-'));
      db = openDatabase(dataDir);
      migrate(db);
      ownerDeps = { db, client, credential, keyOrganisation };
      scans = createScanService({
        db,
        github: createGitHubClient({
          token: new Secret(github.token),
          repositories: [repository],
          baseUrl: github.url,
          contentIntervalMs: 0,
        }),
        repositories: [repository],
        flagsmith: client,
        credential,
        inventory: store,
        logger,
      });
    });

    afterAll(async () => {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
      await github.close();
    });

    async function features(): Promise<ListedFeature[]> {
      return listFeatures(client, credential, inventory.project.id, undefined);
    }

    function referencesOf(flag: string): string[] {
      return references
        .filter((record) => record.flagName === flag)
        .map((record) => `${record.filePath}:${record.line}`)
        .sort();
    }

    it('lists the organisation directory with the organisation key: the operator and the groups', async () => {
      const directory = await readDirectory(ownerDeps);

      expect(directory.users).toHaveLength(1);
      expect(directory.groups).toEqual([]);
    });

    it('scans the demo shop and uploads it; Flagsmith then holds the same references for every flag (S4.2)', async () => {
      scans.requestAll();
      await scans.run();

      const scan = latestSuccessfulScan(db, repository);
      expect(scan?.commitSha).toBe(github.head(repository));
      expect(scan?.uploadedAt).not.toBeNull();
      references = scanRecords(db, scan?.id ?? 0).filter((record) => record.kind === 'reference');
      expect(references).toHaveLength(14);
      for (const feature of await features()) {
        const count = feature.code_references_counts.find(
          (entry) => entry.repository_url === repositoryUrl,
        );
        expect(count?.count ?? 0, feature.name).toBe(referencesOf(feature.name).length);
        const path = '/api/v1/projects/{project_pk}/features/{feature_pk}/code-references/';
        const { data } = await client.api.GET(path, {
          params: { path: { project_pk: inventory.project.id, feature_pk: feature.id } },
          headers: authHeaders(credential),
        });
        // A list, one entry per repository, although the published schema declares one object.
        const stored = parseResponse(client, referencesSchema, data, { method: 'GET', path }).find(
          (entry) => entry.repository_url === repositoryUrl,
        );
        expect(stored?.revision ?? scan?.commitSha, feature.name).toBe(scan?.commitSha);
        expect(
          (stored?.code_references ?? [])
            .map((reference) => `${reference.file_path}:${reference.line_number}`)
            .sort(),
          feature.name,
        ).toEqual(referencesOf(feature.name));
      }
    });

    it("gives Flagsmith's own lifecycle counts 6 live, 2 permanent and 2 new in every environment (S4.2)", async () => {
      const path = '/api/v1/environments/{environment_pk}/feature-lifecycle-counts/';
      for (const environment of inventory.environments) {
        const { data } = await client.api.GET(path, {
          params: { path: { environment_pk: environment.id } },
          headers: authHeaders(credential),
        });

        expect(
          parseResponse(client, lifecycleCountsSchema, data, { method: 'GET', path }),
          environment.name,
        ).toEqual({ new: 2, live: 6, stale: 0, permanent: 2, needs_monitoring: 0, to_remove: 0 });
      }
    });

    it('skips a rescan of the same commit with the same flag names (S4.3)', async () => {
      const before = latestSuccessfulScan(db, repository);

      scans.requestAll();
      await scans.run();

      expect(latestSuccessfulScan(db, repository)?.id).toBe(before?.id);
      expect(github.requests.filter((request) => request.path.includes('/tarball/'))).toHaveLength(
        1,
      );
    });

    it('makes the operator an owner of every referenced flag through the mapping, read back from Flagsmith, and changes nothing on a second run (S4.4)', async () => {
      const [operator] = (await readDirectory(ownerDeps)).users;
      if (operator === undefined) {
        throw new Error('The demo organisation has no user');
      }
      const referenced = new Set(references.map((record) => record.flagName));
      // A run of this suite on the same Flagsmith finds the operator already an owner.
      const ownedBefore = new Set(
        (await features())
          .filter((feature) => feature.owners.some((owner) => owner.id === operator.id))
          .map((feature) => feature.name),
      );

      await saveOwnerMappings(
        ownerDeps,
        [{ github: '@AvikSrivastava10', kind: 'user', flagsmithUserId: operator.id }],
        { kind: 'user', userId: operator.id, email: operator.email },
      );
      scans.requestAll();
      await scans.run();

      const first = scans.status().ownerSync;
      expect(first).toMatchObject({ state: 'succeeded', report: { removed: 0, failures: [] } });
      const after = await features();
      for (const feature of after) {
        expect(
          feature.owners.some((owner) => owner.id === operator.id),
          feature.name,
        ).toBe(referenced.has(feature.name) || ownedBefore.has(feature.name));
      }
      const added = first.state === 'succeeded' ? first.report.added : -1;
      expect(added).toBe([...referenced].filter((flag) => !ownedBefore.has(flag ?? '')).length);

      // "Scan now" asks for an owner sync even when no scan is due.
      scans.scanNow(undefined);
      await scans.run();

      expect(scans.status().ownerSync).toMatchObject({
        state: 'succeeded',
        report: { added: 0, removed: 0, failures: [] },
      });
      expect(
        (await features()).map((feature) => [
          feature.name,
          feature.owners.map((owner) => owner.id),
        ]),
      ).toEqual(after.map((feature) => [feature.name, feature.owners.map((owner) => owner.id)]));
    });
  },
);

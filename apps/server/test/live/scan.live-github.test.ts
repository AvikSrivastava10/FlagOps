import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FlagOpsError } from '@flagops/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { publishDemoShop, readDemoShopFiles, type DemoFile } from '../../src/cli/demo-publish.js';
import { Secret } from '../../src/config/secret.js';
import { openDatabase, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { latestSuccessfulScan, scanRecords } from '../../src/db/repos/scans.js';
import { parseResponse } from '../../src/flagsmith/client.js';
import { authHeaders } from '../../src/flagsmith/credentials.js';
import { listFeatures, type ListedFeature } from '../../src/flagsmith/features.js';
import { keyOrganisationResolver } from '../../src/flagsmith/projects.js';
import { createGitHubClient, type GitHubClient } from '../../src/github/client.js';
import {
  createCommit,
  createTree,
  getBranchHead,
  getCommit,
  updateBranch,
} from '../../src/github/git-data.js';
import { createInventoryStore } from '../../src/inventory/store.js';
import { createInventorySync } from '../../src/inventory/sync.js';
import type { Inventory } from '../../src/inventory/types.js';
import { createLogger } from '../../src/logger.js';
import { matchRepository } from '../../src/matcher/match-repository.js';
import type { CodeRecord } from '../../src/matcher/records.js';
import {
  readDirectory,
  saveOwnerMappings,
  type OwnerMappingDeps,
} from '../../src/ownership/mappings.js';
import { createScanService, type ScanService } from '../../src/scanner/scan.js';
import { captureLogs } from '../helpers/log-capture.js';
import { liveClient, liveOrganisationKey, skipReason } from '../helpers/live.js';

/**
 * Stage 4 against the published DEMO_REPO and the seeded demo organisation (plan S4.1 to S4.4):
 * the scan of the default branch, the Code References upload, Flagsmith's lifecycle counts, a new
 * commit picked up by the next run after a sync, and the owner sync. The new commit is a normal
 * commit that a second normal commit reverts, and the suite ends by restoring the pristine demo
 * shop as `pnpm demo:publish` does. The upload and the owners stay in Flagsmith, as a scan leaves
 * them.
 */
const skip = skipReason('FLAGSMITH_URL', 'FLAGSMITH_ORG_API_KEY', 'GITHUB_TOKEN', 'DEMO_REPO');
const minute = 60_000;

const referencesSchema = z.array(
  z.object({
    repository_url: z.string(),
    revision: z.string(),
    code_references: z.array(z.object({ file_path: z.string(), line_number: z.number() })),
  }),
);

const lifecycleCountsSchema = z.record(z.string(), z.number());

describe.skipIf(skip !== undefined)(
  `scanning DEMO_REPO, Code References and owners, live${skip === undefined ? '' : ` (${skip})`}`,
  () => {
    const repository = process.env.DEMO_REPO?.trim() ?? '';
    const repositoryUrl = `https://github.com/${repository}`;
    const client = liveClient();
    const credential = liveOrganisationKey();
    const keyOrganisation = keyOrganisationResolver(client, credential);
    const logger = createLogger('error', captureLogs().destination);
    let github: GitHubClient;
    let files: DemoFile[];
    let ownerDeps: OwnerMappingDeps;
    let dataDir: string;
    let db: Db;
    let scans: ScanService;
    let inventory: Inventory;

    beforeAll(async () => {
      const store = createInventoryStore();
      inventory = await createInventorySync({
        client,
        credential,
        keyOrganisation,
        projectId: undefined,
        store,
        logger,
      }).run();
      github = createGitHubClient({
        token: new Secret(process.env.GITHUB_TOKEN?.trim() ?? ''),
        repositories: [repository],
        logger,
      });
      files = await readDemoShopFiles();
      dataDir = mkdtempSync(path.join(tmpdir(), 'flagops-scan-live-'));
      db = openDatabase(dataDir);
      migrate(db);
      ownerDeps = { db, client, credential, keyOrganisation };
      scans = createScanService({
        db,
        github,
        repositories: [repository],
        flagsmith: client,
        credential,
        inventory: store,
        logger,
      });
    }, minute);

    afterAll(async () => {
      // Whatever a failed check left behind, DEMO_REPO ends on the pristine demo shop.
      await publishDemoShop(github, repository, files, logger);
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }, 2 * minute);

    /**
     * What the sync job does after each sync: every tracked repository gets its head check. A
     * Flagsmith write that failed on the network, such as an upload over a connection Flagsmith
     * had just closed, is retried by the next run (architecture.md 6.5, 18.2), so the helper
     * gives the product that one next run.
     */
    async function scanAfterSync() {
      scans.requestAll();
      try {
        await scans.run();
      } catch (error) {
        if (!(error instanceof FlagOpsError) || error.code !== 'flagsmith_unreachable') {
          throw error;
        }
        scans.requestAll();
        await scans.run();
      }
      const scan = latestSuccessfulScan(db, repository);
      if (scan === undefined) {
        throw new Error(`no successful scan of ${repository}`);
      }
      return { scan, records: scanRecords(db, scan.id) };
    }

    async function features(): Promise<ListedFeature[]> {
      return listFeatures(client, credential, inventory.project.id, undefined);
    }

    async function storedReferences(feature: ListedFeature) {
      const path = '/api/v1/projects/{project_pk}/features/{feature_pk}/code-references/';
      const { data } = await client.api.GET(path, {
        params: { path: { project_pk: inventory.project.id, feature_pk: feature.id } },
        headers: authHeaders(credential),
      });
      // A list, one entry per repository, although the published schema declares one object.
      return parseResponse(client, referencesSchema, data, { method: 'GET', path }).find(
        (entry) => entry.repository_url === repositoryUrl,
      );
    }

    function places(records: readonly CodeRecord[], flag: string): string[] {
      return records
        .filter((record) => record.kind === 'reference' && record.flagName === flag)
        .map((record) => `${record.filePath}:${record.line}`)
        .sort();
    }

    it('lists the organisation directory with the organisation key: the operator and no groups', async () => {
      const directory = await readDirectory(ownerDeps);

      expect(directory.users).toHaveLength(1);
      expect(directory.groups).toEqual([]);
    });

    it("scans DEMO_REPO's head and finds exactly the records of the pristine demo shop (S4.1)", async () => {
      const { scan, records } = await scanAfterSync();

      expect(scan.commitSha).toBe(await getBranchHead(github, repository, 'main'));
      expect(scan.codeowners?.path).toBe('.github/CODEOWNERS');
      const flagNames = inventory.flags.map((flag) => flag.name);
      const offline = matchRepository(
        files.map((file) => ({ path: file.path, text: file.content })),
        flagNames,
      );
      expect(records).toEqual(offline.records);
      const count = (kind: string) => records.filter((record) => record.kind === kind).length;
      expect([count('reference'), count('test_reference'), count('test_mention')]).toEqual([
        14, 2, 18,
      ]);
      expect(records.filter((record) => record.kind === 'unresolved_name')).toMatchObject([
        { literal: 'recomendations_v2', suggestion: 'recommendations_v2' },
      ]);
      for (const kind of ['dynamic', 'unattributed', 'ambiguous_name', 'mention']) {
        expect(count(kind), kind).toBe(0);
      }
    });

    it('uploads the scan, and Flagsmith holds the same references for every flag at that commit (S4.2)', async () => {
      const { scan, records } = await scanAfterSync();

      expect(scan.uploadedAt).not.toBeNull();
      for (const feature of await features()) {
        const count = feature.code_references_counts.find(
          (entry) => entry.repository_url === repositoryUrl,
        );
        expect(count?.count ?? 0, feature.name).toBe(places(records, feature.name).length);
        const stored = await storedReferences(feature);
        const expected = places(records, feature.name);
        expect(stored === undefined ? [] : [stored.revision], feature.name).toEqual(
          expected.length === 0 ? [] : [scan.commitSha],
        );
        expect(
          (stored?.code_references ?? []).map((item) => `${item.file_path}:${item.line_number}`),
          feature.name,
        ).toEqual(expected);
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

    it(
      'skips a rescan of the same commit with the same flag names, and scans a new commit on the next run (S4.3)',
      async () => {
        const before = latestSuccessfulScan(db, repository);
        expect((await scanAfterSync()).scan.id).toBe(before?.id);

        const readme = files.find((file) => file.path === 'README.md')?.content ?? '';
        const commitWith = async (content: string, message: string): Promise<string> => {
          const head = (await getBranchHead(github, repository, 'main')) ?? '';
          const treeSha = await createTree(
            github,
            repository,
            (await getCommit(github, repository, head)).treeSha,
            [{ path: 'README.md', content }],
          );
          const sha = await createCommit(github, repository, {
            message,
            treeSha,
            parentShas: [head],
          });
          await updateBranch(github, repository, 'main', sha);
          return sha;
        };

        const changed = await commitWith(
          `${readme}\nScanned by FlagOps' live suite.\n`,
          'docs: note a scan check in the README',
        );
        const afterChange = await scanAfterSync();
        expect(afterChange.scan.commitSha).toBe(changed);
        expect(afterChange.scan.id).not.toBe(before?.id);

        const reverted = await commitWith(readme, 'docs: restore the README');
        const afterRevert = await scanAfterSync();
        expect(afterRevert.scan.commitSha).toBe(reverted);
        const newCheckout = (await features()).find((feature) => feature.name === 'new_checkout');
        expect(
          newCheckout === undefined ? undefined : (await storedReferences(newCheckout))?.revision,
        ).toBe(reverted);
      },
      3 * minute,
    );

    it('makes the operator an owner of every referenced flag through the mapping, read back from Flagsmith, and changes nothing on a second run (S4.4)', async () => {
      const [operator] = (await readDirectory(ownerDeps)).users;
      if (operator === undefined) {
        throw new Error('The demo organisation has no user');
      }
      const { records } = await scanAfterSync();
      const referenced = new Set(
        records.filter((record) => record.kind === 'reference').map((record) => record.flagName),
      );
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
      await scanAfterSync();

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
      const owners = (list: ListedFeature[]) =>
        list.map((feature) => [feature.name, feature.owners.map((owner) => owner.id)]);
      expect(owners(await features())).toEqual(owners(after));
    });
  },
);

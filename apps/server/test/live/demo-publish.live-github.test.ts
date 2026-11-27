import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  demoShopRoot,
  listUncommittedPaths,
  publishDemoShop,
  readDemoShopFiles,
  type DemoFile,
} from '../../src/cli/demo-publish.js';
import { Secret } from '../../src/config/secret.js';
import { listRunsForCommit, type WorkflowRun } from '../../src/github/actions.js';
import { createGitHubClient, type GitHubClient } from '../../src/github/client.js';
import {
  createCommit,
  createTree,
  getBranchHead,
  getCommit,
  getTree,
  gitBlobSha,
  updateBranch,
} from '../../src/github/git-data.js';
import { createLogger } from '../../src/logger.js';
import { captureLogs } from '../helpers/log-capture.js';

// Live against DEMO_REPO (plan.md P1.2 and P1.3). It changes only DEMO_REPO's default branch, with
// normal commits, and leaves it holding the pristine demo shop.

const missing = ['GITHUB_TOKEN', 'DEMO_REPO'].filter((name) => !process.env[name]?.trim());
const minute = 60_000;

describe.skipIf(missing.length > 0)(
  `pnpm demo:publish on DEMO_REPO${missing.length > 0 ? ` (skipped: set ${missing.join(' and ')} in .env)` : ''}`,
  () => {
    const repository = process.env.DEMO_REPO?.trim() ?? '';
    const logger = createLogger('info', captureLogs().destination);
    let client: GitHubClient;
    let files: DemoFile[] = [];

    async function headFiles(): Promise<Record<string, string>> {
      const head = await getBranchHead(client, repository, 'main');
      const commit = await getCommit(client, repository, head ?? '');
      const tree = await getTree(client, repository, commit.treeSha);
      return Object.fromEntries(
        tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]),
      );
    }

    async function completedRun(sha: string): Promise<WorkflowRun> {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const run = (await listRunsForCommit(client, repository, sha)).find(
          (candidate) => candidate.event === 'push',
        );
        if (run?.status === 'completed') {
          return run;
        }
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
      throw new Error(`no completed Actions run for ${sha} after 10 minutes`);
    }

    beforeAll(async () => {
      // Like pnpm demo:publish, the suite publishes only a clean, committed demo shop.
      const uncommitted = await listUncommittedPaths(demoShopRoot);
      if (uncommitted.length > 0) {
        throw new Error(
          `Commit or remove the demo shop's changes first: ${uncommitted.join(', ')}`,
        );
      }
      client = createGitHubClient({
        token: new Secret(process.env.GITHUB_TOKEN?.trim() ?? ''),
        repositories: [repository],
      });
      files = await readDemoShopFiles(demoShopRoot);
    });

    afterAll(async () => {
      // Whatever failed above, DEMO_REPO ends up holding the pristine demo shop (testing.md 9).
      if (files.length > 0) {
        await publishDemoShop(client, repository, files, logger);
      }
    }, 5 * minute);

    const pristine = () =>
      Object.fromEntries(files.map((file) => [file.path, gitBlobSha(file.content)]));

    it(
      'publishes the pristine demo shop, and CI passes on main in one job',
      async () => {
        const result = await publishDemoShop(client, repository, files, logger);

        expect(await headFiles()).toEqual(pristine());
        const run = await completedRun(result.headSha);
        const jobs = await client.request({
          method: 'GET',
          repository,
          path: `/actions/runs/${run.id}/jobs`,
          schema: z.object({ total_count: z.number() }),
        });
        const seconds = (Date.parse(run.updatedAt) - Date.parse(run.startedAt)) / 1000;
        console.info(
          `Actions run ${run.url}: ${run.conclusion ?? 'none'} in ${seconds} s, ${jobs.total_count} job(s)`,
        );
        expect(run.conclusion).toBe('success');
        expect(jobs.total_count).toBe(1);
      },
      12 * minute,
    );

    it(
      'makes no commit when nothing changed',
      async () => {
        const before = await getBranchHead(client, repository, 'main');

        const result = await publishDemoShop(client, repository, files, logger);

        expect(result.commitSha).toBeNull();
        expect(await getBranchHead(client, repository, 'main')).toBe(before);
      },
      2 * minute,
    );

    it(
      'restores a deleted demo file and removes an extra file in one normal commit',
      async () => {
        const head = (await getBranchHead(client, repository, 'main')) ?? '';
        const base = await getCommit(client, repository, head);
        // The harness commit mimics a merged cleanup PR; [skip ci] keeps it from starting a run.
        const tree = await createTree(client, repository, base.treeSha, [
          { path: 'web/src/checkout/LegacyCheckout.tsx', delete: true },
          { path: 'notes/live-test.txt', content: 'Added by the demo publish live test.\n' },
        ]);
        const harness = await createCommit(client, repository, {
          message: 'Live test: delete LegacyCheckout.tsx and add a file [skip ci]',
          treeSha: tree,
          parentShas: [head],
        });
        await updateBranch(client, repository, 'main', harness);

        const result = await publishDemoShop(client, repository, files, logger);

        expect(result.plan).toEqual({
          added: ['web/src/checkout/LegacyCheckout.tsx'],
          changed: [],
          removed: ['notes/live-test.txt'],
        });
        expect((await getCommit(client, repository, result.headSha)).parentShas).toEqual([harness]);
        expect(await headFiles()).toEqual(pristine());
      },
      3 * minute,
    );
  },
);

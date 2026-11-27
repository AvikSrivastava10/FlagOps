import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { FlagOpsError } from '@flagops/shared';
import type { Logger } from 'pino';
import { Secret } from '../config/secret.js';
import { createGitHubClient, type GitHubClient } from '../github/client.js';
import {
  createCommit,
  createFirstCommit,
  createTree,
  getBranchHead,
  getCommit,
  getDefaultBranch,
  getTree,
  gitBlobSha,
  updateBranch,
  type TreeChange,
  type TreeEntry,
} from '../github/git-data.js';
import { closePullRequest, listOpenPullRequests } from '../github/pulls.js';
import { isRepositoryName } from '../github/repo-guard.js';
import { createLogger } from '../logger.js';

// `pnpm demo:publish` (architecture.md 13.3, features.md D3): makes DEMO_REPO's default branch hold
// exactly the files of examples/demo-shop, with normal commits only, and closes the pull requests
// FlagOps opened there.

/** The pristine demo shop, in this repository. */
export const demoShopRoot = fileURLToPath(
  new URL('../../../../examples/demo-shop/', import.meta.url),
);

/** Every branch FlagOps creates starts with this (features.md R4.1). */
const flagOpsBranchPrefix = 'flagops/';

/** A demo shop file: its path from the demo shop's root, with `/` separators, and its text. */
export type DemoFile = { path: string; content: string };

/** What a publish changes so that the branch holds exactly the pristine files. */
export type RestorePlan = { added: string[]; changed: string[]; removed: string[] };

export type PublishResult = {
  /** The repository was empty, and the publish created its first commit. */
  initialised: boolean;
  branch: string;
  /** The commit that wrote the pristine files, or null when the branch already held them. */
  commitSha: string | null;
  headSha: string;
  plan: RestorePlan;
  closedPullRequests: number[];
};

/** Compares the pristine files with a branch's tree, by Git object ID and file mode. */
export function planRestore(files: readonly DemoFile[], tree: readonly TreeEntry[]): RestorePlan {
  const remote = new Map(
    tree.filter((entry) => entry.type !== 'tree').map((entry) => [entry.path, entry]),
  );
  const plan: RestorePlan = { added: [], changed: [], removed: [] };
  for (const file of files) {
    const entry = remote.get(file.path);
    if (entry === undefined) {
      plan.added.push(file.path);
    } else if (
      entry.type !== 'blob' ||
      entry.mode !== '100644' ||
      entry.sha !== gitBlobSha(file.content)
    ) {
      plan.changed.push(file.path);
    }
  }
  const pristine = new Set(files.map((file) => file.path));
  plan.removed = [...remote.keys()].filter((remotePath) => !pristine.has(remotePath)).sort();
  return plan;
}

function isEmpty(plan: RestorePlan): boolean {
  return plan.added.length + plan.changed.length + plan.removed.length === 0;
}

function commitMessage(plan: RestorePlan, initialised: boolean): string {
  const sections = (
    [
      ['Added', plan.added],
      ['Updated', plan.changed],
      ['Removed', plan.removed],
    ] as const
  )
    .filter(([, paths]) => paths.length > 0)
    .map(([label, paths]) => `${label}:\n${paths.map((file) => `- ${file}`).join('\n')}`);
  return [
    initialised ? 'Publish the demo shop' : 'Restore the demo shop',
    'pnpm demo:publish wrote the files of examples/demo-shop in the FlagOps repository.',
    ...sections,
  ].join('\n\n');
}

/** Closes the open pull requests whose head is a FlagOps branch of this repository, and only those. */
async function closeFlagOpsPullRequests(
  client: GitHubClient,
  repository: string,
  logger: Logger,
): Promise<number[]> {
  const ours = (await listOpenPullRequests(client, repository)).filter(
    (pull) =>
      pull.headBranch.startsWith(flagOpsBranchPrefix) &&
      pull.headRepository?.toLowerCase() === repository.toLowerCase(),
  );
  for (const pull of ours) {
    await closePullRequest(client, repository, pull.number);
    logger.info(
      { repository, pullRequest: pull.number, branch: pull.headBranch },
      'Closed a FlagOps pull request',
    );
  }
  return ours.map((pull) => pull.number);
}

/**
 * Writes the pristine files to the repository's default branch in one normal commit, never a
 * force-push (DR-7): files missing from the branch are added again, changed files are restored,
 * and files outside the pristine set are removed. An empty repository first gets a commit of
 * README.md, because the Git Data API cannot write to it. No commit is made when nothing differs.
 */
export async function publishDemoShop(
  client: GitHubClient,
  repository: string,
  files: readonly DemoFile[],
  logger: Logger,
): Promise<PublishResult> {
  const branch = await getDefaultBranch(client, repository);
  let head = await getBranchHead(client, repository, branch);
  const initialised = head === null;
  if (head === null) {
    const readme = files.find((file) => file.path === 'README.md');
    if (readme === undefined) {
      throw new Error('The demo shop has no README.md to start the empty repository with');
    }
    head = await createFirstCommit(client, repository, {
      path: readme.path,
      content: readme.content,
      message: 'Initial commit',
    });
    logger.info(
      { repository, branch, commit: head },
      'Started the empty repository with README.md',
    );
  }

  const base = await getCommit(client, repository, head);
  const plan = planRestore(files, await getTree(client, repository, base.treeSha));
  let commitSha: string | null = null;
  if (isEmpty(plan)) {
    logger.info(
      { repository, branch, commit: head },
      'The branch already holds the pristine demo shop',
    );
  } else {
    const upserts = new Set([...plan.added, ...plan.changed]);
    const changes: TreeChange[] = [
      ...files.filter((file) => upserts.has(file.path)),
      ...plan.removed.map((removed) => ({ path: removed, delete: true as const })),
    ];
    const treeSha = await createTree(client, repository, base.treeSha, changes);
    commitSha = await createCommit(client, repository, {
      message: commitMessage(plan, initialised),
      treeSha,
      parentShas: [head],
    });
    await updateBranch(client, repository, branch, commitSha);
    head = commitSha;
    logger.info(
      { repository, branch, commit: commitSha, ...plan },
      initialised ? 'Published the demo shop' : 'Restored the demo shop',
    );
  }

  const closedPullRequests = await closeFlagOpsPullRequests(client, repository, logger);
  return { initialised, branch, commitSha, headSha: head, plan, closedPullRequests };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The demo shop's files as git would commit them: tracked and new files, without ignored ones
 * such as node_modules and build output.
 */
export async function readDemoShopFiles(root: string = demoShopRoot): Promise<DemoFile[]> {
  const listing = await promisify(execFile)(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  // ignoreBOM keeps a byte-order mark, so the text hashes to the file's real Git object ID.
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const files: DemoFile[] = [];
  for (const relative of listing.stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .sort()) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(root, relative));
    } catch (error) {
      // A tracked file deleted from the checkout is no longer part of the demo shop.
      if (isMissingFile(error)) {
        continue;
      }
      throw error;
    }
    try {
      files.push({ path: relative, content: utf8.decode(bytes) });
    } catch {
      throw new Error(`${relative} in the demo shop is not UTF-8 text, and the publish sends text`);
    }
  }
  return files;
}

const variables = {
  GITHUB_TOKEN: 'GitHub token with Contents, Pull requests and Workflows write access to DEMO_REPO',
  DEMO_REPO: 'owner/name of the demo shop repository',
} as const;

/** The publish reads its own two variables; config/env.ts holds only the server's. */
function readEnvironment(env: NodeJS.ProcessEnv): {
  token: string;
  repository: string;
  problems: string[];
} {
  const token = env.GITHUB_TOKEN?.trim() ?? '';
  const repository = env.DEMO_REPO?.trim() ?? '';
  const problems: string[] = [];
  if (token === '') {
    problems.push(`GITHUB_TOKEN is required (${variables.GITHUB_TOKEN})`);
  } else if (token.length < 20 || token.length > 255) {
    problems.push(`GITHUB_TOKEN must be 20 to 255 characters (${variables.GITHUB_TOKEN})`);
  }
  if (repository === '') {
    problems.push(`DEMO_REPO is required (${variables.DEMO_REPO})`);
  } else if (!isRepositoryName(repository)) {
    problems.push(`DEMO_REPO must look like owner/name (${variables.DEMO_REPO})`);
  }
  return { token, repository, problems };
}

async function main(): Promise<void> {
  const logger = createLogger('info');
  const { token, repository, problems } = readEnvironment(process.env);
  if (problems.length > 0) {
    for (const problem of problems) {
      logger.error(problem);
    }
    process.exitCode = 1;
    return;
  }
  try {
    const client = createGitHubClient({
      token: new Secret(token),
      repositories: [repository],
      logger,
    });
    const result = await publishDemoShop(client, repository, await readDemoShopFiles(), logger);
    logger.info(
      {
        repository,
        commit: `https://github.com/${repository}/commit/${result.headSha}`,
        actions: `https://github.com/${repository}/actions`,
        closedPullRequests: result.closedPullRequests,
      },
      'DEMO_REPO holds the pristine demo shop',
    );
  } catch (error) {
    if (error instanceof FlagOpsError) {
      logger.error({ code: error.code, details: error.details }, error.message);
    } else {
      logger.error({ err: error }, 'pnpm demo:publish failed');
    }
    process.exitCode = 1;
  }
}

/** True when Node runs this file as the program, false when a test imports it. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync.native(entry) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  await main();
}

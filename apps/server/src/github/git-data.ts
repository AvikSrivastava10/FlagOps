import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GitHubClient } from './client.js';
import { GitHubError } from './errors.js';

/** Git's object ID for a file: SHA-1 over `blob <byte length>\0` and the bytes. */
export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** A branch name in a path: its slashes stay, everything else is encoded. */
function branchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export async function getDefaultBranch(client: GitHubClient, repository: string): Promise<string> {
  const repo = await client.request({
    method: 'GET',
    repository,
    path: '',
    schema: z.object({ default_branch: z.string() }),
  });
  return repo.default_branch;
}

/** The branch's head commit, or null when the repository has no commits yet (GitHub answers 409). */
export async function getBranchHead(
  client: GitHubClient,
  repository: string,
  branch: string,
): Promise<string | null> {
  try {
    const ref = await client.request({
      method: 'GET',
      repository,
      path: `/git/ref/heads/${branchPath(branch)}`,
      schema: z.object({ object: z.object({ sha: shaSchema }) }),
    });
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GitHubError && error.code === 'github_conflict') {
      return null;
    }
    throw error;
  }
}

export type Commit = { sha: string; treeSha: string; parentShas: string[]; message: string };

export async function getCommit(
  client: GitHubClient,
  repository: string,
  sha: string,
): Promise<Commit> {
  const commit = await client.request({
    method: 'GET',
    repository,
    path: `/git/commits/${encodeURIComponent(sha)}`,
    schema: z.object({
      sha: shaSchema,
      message: z.string(),
      tree: z.object({ sha: shaSchema }),
      parents: z.array(z.object({ sha: shaSchema })),
    }),
  });
  return {
    sha: commit.sha,
    treeSha: commit.tree.sha,
    parentShas: commit.parents.map((parent) => parent.sha),
    message: commit.message,
  };
}

export type TreeEntry = { path: string; mode: string; type: string; sha: string };

/** Every entry of a tree and its subtrees. */
export async function getTree(
  client: GitHubClient,
  repository: string,
  treeSha: string,
): Promise<TreeEntry[]> {
  const tree = await client.request({
    method: 'GET',
    repository,
    path: `/git/trees/${encodeURIComponent(treeSha)}`,
    query: { recursive: 1 },
    schema: z.object({
      truncated: z.boolean(),
      tree: z.array(
        z.object({ path: z.string(), mode: z.string(), type: z.string(), sha: shaSchema }),
      ),
    }),
  });
  // A truncated listing would hide files, and callers compare complete file sets.
  if (tree.truncated) {
    throw new GitHubError(
      'github_validation',
      `The tree of ${repository} is too large for GitHub to list in one response.`,
      { details: { repository, treeSha } },
    );
  }
  return tree.tree;
}

/** A file to write as UTF-8 text, or a path to delete. */
export type TreeChange = { path: string; content: string } | { path: string; delete: true };

/** A new tree: `baseTreeSha` with the changes applied. Every file gets mode 100644. */
export async function createTree(
  client: GitHubClient,
  repository: string,
  baseTreeSha: string,
  changes: readonly TreeChange[],
): Promise<string> {
  const tree = await client.request({
    method: 'POST',
    repository,
    path: '/git/trees',
    createsContent: true,
    body: {
      base_tree: baseTreeSha,
      // `sha: null` deletes the path from the base tree.
      tree: changes.map((change) =>
        'content' in change
          ? { path: change.path, mode: '100644', type: 'blob', content: change.content }
          : { path: change.path, mode: '100644', type: 'blob', sha: null },
      ),
    },
    schema: z.object({ sha: shaSchema }),
  });
  return tree.sha;
}

/** A commit of `treeSha` on top of the parents. The author is the token's owner. */
export async function createCommit(
  client: GitHubClient,
  repository: string,
  commit: { message: string; treeSha: string; parentShas: readonly string[] },
): Promise<string> {
  const created = await client.request({
    method: 'POST',
    repository,
    path: '/git/commits',
    createsContent: true,
    body: { message: commit.message, tree: commit.treeSha, parents: commit.parentShas },
    schema: z.object({ sha: shaSchema }),
  });
  return created.sha;
}

/**
 * Moves a branch to a commit that descends from its head. `force` is always false, so GitHub
 * refuses anything but a fast-forward and history is never rewritten. Only the demo publish moves
 * a default branch (architecture.md 19).
 */
export async function updateBranch(
  client: GitHubClient,
  repository: string,
  branch: string,
  sha: string,
): Promise<void> {
  await client.request({
    method: 'PATCH',
    repository,
    path: `/git/refs/heads/${branchPath(branch)}`,
    createsContent: true,
    body: { sha, force: false },
    schema: z.object({ object: z.object({ sha: shaSchema }) }),
  });
}

/**
 * Creates the first commit of an empty repository, holding one file, on its default branch. The
 * Git Data API refuses to write to an empty repository, and the contents API is the only way to
 * start one.
 */
export async function createFirstCommit(
  client: GitHubClient,
  repository: string,
  file: { path: string; content: string; message: string },
): Promise<string> {
  const created = await client.request({
    method: 'PUT',
    repository,
    path: `/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`,
    createsContent: true,
    body: { message: file.message, content: Buffer.from(file.content, 'utf8').toString('base64') },
    schema: z.object({ commit: z.object({ sha: shaSchema }) }),
  });
  return created.commit.sha;
}

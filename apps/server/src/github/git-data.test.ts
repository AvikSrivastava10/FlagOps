import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../test/helpers/fake-github.js';
import { Secret } from '../config/secret.js';
import { listRunsForCommit } from './actions.js';
import { createGitHubClient, type GitHubClient } from './client.js';
import { createFirstCommit, getBranchHead, getCommit, getTree, gitBlobSha } from './git-data.js';

const repository = 'demo-owner/demo-shop';

let github: FakeGitHub;
let client: GitHubClient;

beforeEach(async () => {
  github = await FakeGitHub.start();
  client = createGitHubClient({
    token: new Secret(github.token),
    repositories: [repository],
    baseUrl: github.url,
    contentIntervalMs: 0,
    retryDelaysMs: [0, 0],
  });
});

afterEach(async () => {
  await github.close();
});

describe('git data', () => {
  it("computes a file's Git object ID", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('reads no head for an empty repository, and starts one with a first commit', async () => {
    github.addRepository(repository);

    expect(await getBranchHead(client, repository, 'main')).toBeNull();

    const sha = await createFirstCommit(client, repository, {
      path: 'README.md',
      content: '# Demo shop\n',
      message: 'Initial commit',
    });
    const commit = await getCommit(client, repository, sha);

    expect(await getBranchHead(client, repository, 'main')).toBe(sha);
    expect(commit.parentShas).toEqual([]);
    expect(await getTree(client, repository, commit.treeSha)).toEqual([
      { path: 'README.md', mode: '100644', type: 'blob', sha: gitBlobSha('# Demo shop\n') },
    ]);
  });

  it('refuses a truncated tree listing, which would hide files', async () => {
    github.addRepository(repository, { files: { 'README.md': '# Demo shop\n' } });
    github.failNext(
      { path: /\/git\/trees\// },
      { status: 200, body: { truncated: true, tree: [] } },
    );

    await expect(getTree(client, repository, 'b'.repeat(40))).rejects.toMatchObject({
      code: 'github_validation',
    });
  });

  it('lists the Actions runs of a commit with their state', async () => {
    github.addRepository(repository, { files: { 'README.md': '# Demo shop\n' } });
    const head = github.head(repository)!;
    github.addWorkflowRun(repository, {
      id: 7,
      headSha: head,
      status: 'completed',
      conclusion: 'success',
    });
    github.addWorkflowRun(repository, {
      id: 8,
      headSha: 'c'.repeat(40),
      status: 'queued',
      conclusion: null,
    });

    expect(await listRunsForCommit(client, repository, head)).toEqual([
      expect.objectContaining({ id: 7, status: 'completed', conclusion: 'success' }),
    ]);
  });
});

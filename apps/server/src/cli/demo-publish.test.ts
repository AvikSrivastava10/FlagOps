import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../test/helpers/fake-github.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { Secret } from '../config/secret.js';
import { createGitHubClient } from '../github/client.js';
import { gitBlobSha, type TreeEntry } from '../github/git-data.js';
import { createLogger } from '../logger.js';
import { planRestore, publishDemoShop, type DemoFile } from './demo-publish.js';

const repository = 'demo-owner/demo-shop';

const files: DemoFile[] = [
  { path: '.github/workflows/ci.yml', content: 'name: CI\n' },
  { path: 'README.md', content: '# Demo shop\n' },
  { path: 'web/src/checkout/LegacyCheckout.tsx', content: 'export function LegacyCheckout() {}\n' },
];
const pristine = Object.fromEntries(files.map((file) => [file.path, file.content]));

function blob(path: string, content: string, mode = '100644'): TreeEntry {
  return { path, mode, type: 'blob', sha: gitBlobSha(content) };
}

describe('planRestore', () => {
  it('plans nothing when the tree holds exactly the pristine files', () => {
    const tree = files.map((file) => blob(file.path, file.content));

    expect(planRestore(files, tree)).toEqual({ added: [], changed: [], removed: [] });
  });

  it('adds missing files, restores changed ones and removes everything else', () => {
    const tree = [
      blob('.github/workflows/ci.yml', 'name: CI\n'),
      blob('README.md', '# Edited\n'),
      blob('notes.txt', 'extra\n'),
      { path: 'vendor/lib', mode: '160000', type: 'commit', sha: 'd'.repeat(40) },
    ];

    expect(planRestore(files, tree)).toEqual({
      added: ['web/src/checkout/LegacyCheckout.tsx'],
      changed: ['README.md'],
      removed: ['notes.txt', 'vendor/lib'],
    });
  });

  it('restores a file whose content matches but whose mode differs', () => {
    const tree = files.map((file) =>
      blob(file.path, file.content, file.path === 'README.md' ? '100755' : '100644'),
    );

    expect(planRestore(files, tree).changed).toEqual(['README.md']);
  });

  it('ignores directory entries', () => {
    const tree = [
      ...files.map((file) => blob(file.path, file.content)),
      { path: 'web', mode: '040000', type: 'tree', sha: 'e'.repeat(40) },
    ];

    expect(planRestore(files, tree)).toEqual({ added: [], changed: [], removed: [] });
  });
});

describe('publishDemoShop', () => {
  let github: FakeGitHub;

  beforeEach(async () => {
    github = await FakeGitHub.start();
  });

  afterEach(async () => {
    await github.close();
  });

  function publish(target = repository) {
    const client = createGitHubClient({
      token: new Secret(github.token),
      repositories: [repository],
      baseUrl: github.url,
      contentIntervalMs: 0,
      retryDelaysMs: [0, 0],
    });
    return publishDemoShop(client, target, files, createLogger('info', captureLogs().destination));
  }

  it('starts an empty repository with README.md, then adds the rest in one commit', async () => {
    github.addRepository(repository);

    const result = await publish();

    const publishCommit = github.commit(result.headSha)!;
    const firstCommit = github.commit(publishCommit.parents[0]!)!;
    expect(github.files(repository)).toEqual(pristine);
    expect(firstCommit.parents).toEqual([]);
    expect(result).toMatchObject({
      initialised: true,
      branch: 'main',
      commitSha: result.headSha,
      plan: {
        added: ['.github/workflows/ci.yml', 'web/src/checkout/LegacyCheckout.tsx'],
        changed: [],
        removed: [],
      },
    });
  });

  it('makes no commit when the branch already holds the pristine files', async () => {
    github.addRepository(repository, { files: pristine });
    const head = github.head(repository);

    const result = await publish();

    expect(result).toMatchObject({ initialised: false, commitSha: null, headSha: head });
    expect(github.head(repository)).toBe(head);
    expect(github.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  it('restores deleted and changed files and removes extra ones in one normal commit', async () => {
    github.addRepository(repository, {
      files: {
        '.github/workflows/ci.yml': 'name: CI\n',
        'README.md': '# Edited\n',
        'notes.txt': 'x\n',
      },
    });
    const before = github.head(repository);

    const result = await publish();

    expect(github.files(repository)).toEqual(pristine);
    expect(github.commit(result.headSha)?.parents).toEqual([before]);
    expect(result.plan).toEqual({
      added: ['web/src/checkout/LegacyCheckout.tsx'],
      changed: ['README.md'],
      removed: ['notes.txt'],
    });
    const refUpdates = github.requests.filter(
      (request) => request.method === 'PATCH' && request.path.includes('/git/refs/'),
    );
    expect(refUpdates.map((request) => request.body)).toEqual([
      { sha: result.headSha, force: false },
    ]);
  });

  it('closes open pull requests from flagops/ branches and leaves every other one alone', async () => {
    github.addRepository(repository, { files: pristine });
    const ours = github.addPullRequest(repository, {
      headBranch: 'flagops/retire-new_checkout-1a2b3c4d-1',
    });
    const feature = github.addPullRequest(repository, { headBranch: 'feature/flagops/retire' });
    const fromFork = github.addPullRequest(repository, {
      headBranch: 'flagops/retire-dark_mode-5e6f7a8b-2',
      headRepository: 'someone/demo-shop',
    });

    const result = await publish();

    expect(result.closedPullRequests).toEqual([ours]);
    expect(github.pullRequest(repository, ours)?.state).toBe('closed');
    expect(github.pullRequest(repository, feature)?.state).toBe('open');
    expect(github.pullRequest(repository, fromFork)?.state).toBe('open');
  });

  it('refuses to write to any repository other than DEMO_REPO', async () => {
    github.addRepository('someone/else');

    await expect(publish('someone/else')).rejects.toMatchObject({
      code: 'github_repo_not_allowed',
    });
    expect(github.requests).toEqual([]);
  });

  it('stops at a missing token permission and leaves the branch and pull requests as they were', async () => {
    github.addRepository(repository, { files: { 'README.md': '# Demo shop\n' } });
    const before = github.head(repository);
    const ours = github.addPullRequest(repository, { headBranch: 'flagops/retire-x-1a2b3c4d-1' });
    github.failNext(
      { method: 'PATCH', path: /\/git\/refs\/heads\/main$/ },
      {
        status: 403,
        headers: { 'x-accepted-github-permissions': 'contents=write; workflows=write' },
        body: { message: 'Resource not accessible by personal access token' },
      },
    );

    await expect(publish()).rejects.toMatchObject({
      code: 'github_missing_permission',
      details: { permissions: 'contents=write; workflows=write' },
    });
    expect(github.head(repository)).toBe(before);
    expect(github.pullRequest(repository, ours)?.state).toBe('open');
  });
});

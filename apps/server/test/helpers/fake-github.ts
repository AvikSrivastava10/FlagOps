import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gitBlobSha } from '../../src/github/git-data.js';
import { repositoryTarball } from './tarball.js';

// An in-process stand-in for the parts of GitHub's REST API that FlagOps calls, with git objects
// kept in memory. It answers the way GitHub does where FlagOps depends on it: 409 for an empty
// repository, `sha: null` deleting a path, a non-fast-forward ref update refused, `Link` paging.

type TreeFiles = Map<string, { mode: string; sha: string }>;
type FakeCommit = { tree: string; parents: string[]; message: string };

const emptyTree = (): TreeFiles => new Map();

export type FakePullRequest = {
  number: number;
  state: 'open' | 'closed';
  headBranch: string;
  /** `owner/name` of the head branch's repository: another repository means a fork. */
  headRepository: string;
};

export type FakeWorkflowRun = {
  id: number;
  headSha: string;
  status: string;
  conclusion: string | null;
};

type FakeRepository = {
  fullName: string;
  defaultBranch: string;
  refs: Map<string, string>;
  pulls: FakePullRequest[];
  runs: FakeWorkflowRun[];
};

export type RecordedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
  /** Milliseconds since the epoch when the request arrived. */
  at: number;
};

export type InjectedFailure = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function notFound(): Reply {
  return { status: 404, body: { message: 'Not Found' } };
}

export class FakeGitHub {
  readonly token: string;
  readonly requests: RecordedRequest[] = [];
  readonly #server: Server;
  readonly #repositories = new Map<string, FakeRepository>();
  readonly #blobs = new Map<string, string>();
  readonly #trees = new Map<string, TreeFiles>();
  readonly #commits = new Map<string, FakeCommit>();
  readonly #failures: { method: string | undefined; path: RegExp; failure: InjectedFailure }[] = [];
  #remaining = 5000;
  #commitCount = 0;

  private constructor(token: string) {
    this.token = token;
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  /** Starts a fake on a free loopback port. Requests must carry `Authorization: Bearer <token>`. */
  static async start(token = 'fake-github-token-0001'): Promise<FakeGitHub> {
    const fake = new FakeGitHub(token);
    await new Promise<void>((resolve) => fake.#server.listen(0, '127.0.0.1', resolve));
    return fake;
  }

  get url(): string {
    const { port } = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /** A repository, empty unless `files` are given, which become its first commit. */
  addRepository(fullName: string, options: { files?: Record<string, string> } = {}): void {
    const repository: FakeRepository = {
      fullName,
      defaultBranch: 'main',
      refs: new Map(),
      pulls: [],
      runs: [],
    };
    this.#repositories.set(fullName.toLowerCase(), repository);
    if (options.files !== undefined) {
      const tree = this.#storeTree(
        new Map(
          Object.entries(options.files).map(([path, content]) => [
            path,
            { mode: '100644', sha: this.#storeBlob(content) },
          ]),
        ),
      );
      repository.refs.set('main', this.#storeCommit({ tree, parents: [], message: 'Seed' }));
    }
  }

  addPullRequest(
    repository: string,
    pull: { headBranch: string; headRepository?: string },
  ): number {
    const pulls = this.#repository(repository).pulls;
    const number = pulls.length + 1;
    pulls.push({
      number,
      state: 'open',
      headBranch: pull.headBranch,
      headRepository: pull.headRepository ?? repository,
    });
    return number;
  }

  addWorkflowRun(repository: string, run: FakeWorkflowRun): void {
    this.#repository(repository).runs.push(run);
  }

  pullRequest(repository: string, number: number): FakePullRequest | undefined {
    return this.#repository(repository).pulls.find((pull) => pull.number === number);
  }

  head(repository: string): string | undefined {
    const fake = this.#repository(repository);
    return fake.refs.get(fake.defaultBranch);
  }

  commit(sha: string): FakeCommit | undefined {
    return this.#commits.get(sha);
  }

  /** The files at the head of the default branch, with their text. */
  files(repository: string): Record<string, string> {
    const head = this.head(repository);
    const tree = head === undefined ? emptyTree() : this.#treeOfCommit(head);
    return Object.fromEntries(
      [...tree.entries()].map(([path, entry]) => [path, this.#blobs.get(entry.sha) ?? '']),
    );
  }

  /** The next request matching `method` and `path` gets this response instead. */
  failNext(match: { method?: string; path: RegExp }, failure: InjectedFailure): void {
    this.#failures.push({ method: match.method, path: match.path, failure });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://fake-github');
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const body: unknown = text === '' ? undefined : JSON.parse(text);
    const method = request.method ?? 'GET';
    this.requests.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
      at: Date.now(),
    });
    // The tarball redirect's target stands in for codeload.github.com, which needs no token.
    const download = /^\/_codeload\/([^/]+\/[^/]+)\/tar\.gz\/([0-9a-f]{40})$/.exec(url.pathname);
    if (download !== null) {
      this.#sendTarball(response, download[1] ?? '', download[2] ?? '');
      return;
    }

    this.#remaining = Math.max(0, this.#remaining - 1);
    const reply = this.#reply(method, url, request.headers.authorization, body);
    response.writeHead(reply.status, {
      'content-type': 'application/json',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': String(this.#remaining),
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      ...reply.headers,
    });
    response.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  }

  #reply(method: string, url: URL, authorization: string | undefined, body: unknown): Reply {
    const failure = this.#failures.findIndex(
      (entry) => (entry.method ?? method) === method && entry.path.test(url.pathname),
    );
    if (failure !== -1) {
      return this.#failures.splice(failure, 1)[0]!.failure;
    }
    if (authorization !== `Bearer ${this.token}`) {
      return { status: 401, body: { message: 'Bad credentials' } };
    }
    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    const repository = match && this.#repositories.get(`${match[1]}/${match[2]}`.toLowerCase());
    if (!match || !repository) {
      return notFound();
    }
    return this.#route(repository, method, match[3] ?? '', url.searchParams, body);
  }

  #route(
    repository: FakeRepository,
    method: string,
    path: string,
    query: URLSearchParams,
    body: unknown,
  ): Reply {
    const route = `${method} ${path}`;
    let found: RegExpExecArray | null;
    if (route === 'GET ') {
      return {
        status: 200,
        body: { full_name: repository.fullName, default_branch: repository.defaultBranch },
      };
    }
    if (repository.refs.size === 0 && path.startsWith('/git/')) {
      // GitHub's answer for refs, trees and commits of a repository without commits.
      return { status: 409, body: { message: 'Git Repository is empty.' } };
    }
    if ((found = /^GET \/git\/ref\/heads\/(.+)$/.exec(route))) {
      const sha = repository.refs.get(decodeURIComponent(found[1] ?? ''));
      return sha === undefined ? notFound() : { status: 200, body: { object: { sha } } };
    }
    if ((found = /^PATCH \/git\/refs\/heads\/(.+)$/.exec(route))) {
      return this.#moveBranch(repository, decodeURIComponent(found[1] ?? ''), body);
    }
    if ((found = /^GET \/tarball\/([0-9a-f]{40})$/.exec(route))) {
      const location = `${this.url}/_codeload/${repository.fullName}/tar.gz/${found[1] ?? ''}`;
      return { status: 302, headers: { location } };
    }
    if ((found = /^GET \/git\/commits\/([0-9a-f]{40})$/.exec(route))) {
      const commit = this.#commits.get(found[1] ?? '');
      return commit === undefined
        ? notFound()
        : { status: 200, body: this.#commitBody(found[1] ?? '', commit) };
    }
    if (route === 'POST /git/commits') {
      const { message, tree, parents } = body as {
        message: string;
        tree: string;
        parents: string[];
      };
      return { status: 201, body: { sha: this.#storeCommit({ message, tree, parents }) } };
    }
    if ((found = /^GET \/git\/trees\/([0-9a-f]{40})$/.exec(route))) {
      const tree = this.#trees.get(found[1] ?? '');
      return tree === undefined
        ? notFound()
        : { status: 200, body: { sha: found[1], truncated: false, tree: this.#listing(tree) } };
    }
    if (route === 'POST /git/trees') {
      return this.#createTree(body as { base_tree?: string; tree: Record<string, unknown>[] });
    }
    if ((found = /^PUT \/contents\/(.+)$/.exec(route))) {
      return this.#putFile(repository, decodeURIComponent(found[1] ?? ''), body);
    }
    if (route === 'GET /pulls') {
      return this.#pullsPage(repository, query);
    }
    if ((found = /^PATCH \/pulls\/(\d+)$/.exec(route))) {
      const pull = repository.pulls.find((candidate) => candidate.number === Number(found?.[1]));
      if (pull === undefined) {
        return notFound();
      }
      pull.state = (body as { state: 'open' | 'closed' }).state;
      return { status: 200, body: { number: pull.number, state: pull.state } };
    }
    if (route === 'GET /actions/runs') {
      const runs = repository.runs.filter((run) => run.headSha === query.get('head_sha'));
      return {
        status: 200,
        body: {
          total_count: runs.length,
          workflow_runs: runs.map((run) => ({
            id: run.id,
            event: 'push',
            status: run.status,
            conclusion: run.conclusion,
            head_sha: run.headSha,
            html_url: `https://github.com/${repository.fullName}/actions/runs/${run.id}`,
            run_started_at: '2026-11-27T10:00:00Z',
            updated_at: '2026-11-27T10:01:00Z',
          })),
        },
      };
    }
    return notFound();
  }

  /** The gzipped tarball of a commit, with GitHub's top-level folder. */
  #sendTarball(response: ServerResponse, fullName: string, sha: string): void {
    if (!this.#commits.has(sha)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Not Found' }));
      return;
    }
    const files = Object.fromEntries(
      [...this.#treeOfCommit(sha).entries()].map(([path, entry]) => [
        path,
        this.#blobs.get(entry.sha) ?? '',
      ]),
    );
    response.writeHead(200, { 'content-type': 'application/x-gzip' });
    response.end(repositoryTarball(fullName, sha, files));
  }

  #repository(fullName: string): FakeRepository {
    const repository = this.#repositories.get(fullName.toLowerCase());
    if (repository === undefined) {
      throw new Error(`the fake GitHub has no repository ${fullName}`);
    }
    return repository;
  }

  #storeBlob(content: string): string {
    const sha = gitBlobSha(content);
    this.#blobs.set(sha, content);
    return sha;
  }

  #storeTree(files: TreeFiles): string {
    const entries = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = sha1(`tree ${JSON.stringify(entries)}`);
    this.#trees.set(sha, new Map(entries));
    return sha;
  }

  #storeCommit(commit: FakeCommit): string {
    this.#commitCount += 1;
    const sha = sha1(`commit ${this.#commitCount} ${JSON.stringify(commit)}`);
    this.#commits.set(sha, commit);
    return sha;
  }

  #treeOfCommit(sha: string): TreeFiles {
    const commit = this.#commits.get(sha);
    return (commit && this.#trees.get(commit.tree)) ?? emptyTree();
  }

  #commitBody(sha: string, commit: FakeCommit) {
    return {
      sha,
      message: commit.message,
      tree: { sha: commit.tree },
      parents: commit.parents.map((parent) => ({ sha: parent })),
    };
  }

  /** Blobs with their paths, plus an entry per directory, as `?recursive=1` lists them. */
  #listing(tree: TreeFiles) {
    const directories = new Set<string>();
    for (const path of tree.keys()) {
      const parts = path.split('/');
      for (let depth = 1; depth < parts.length; depth += 1) {
        directories.add(parts.slice(0, depth).join('/'));
      }
    }
    return [
      ...[...directories].map((path) => ({
        path,
        mode: '040000',
        type: 'tree',
        sha: sha1(`dir ${path}`),
      })),
      ...[...tree.entries()].map(([path, entry]) => ({
        path,
        mode: entry.mode,
        type: 'blob',
        sha: entry.sha,
      })),
    ].sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  #createTree(body: { base_tree?: string; tree: Record<string, unknown>[] }): Reply {
    const base = body.base_tree === undefined ? emptyTree() : this.#trees.get(body.base_tree);
    if (base === undefined) {
      return { status: 422, body: { message: 'base_tree is not a valid tree' } };
    }
    const files: TreeFiles = new Map(base);
    for (const entry of body.tree) {
      const path = String(entry.path);
      const mode = String(entry.mode);
      if (entry.sha === null) {
        for (const existing of [...files.keys()]) {
          if (existing === path || existing.startsWith(`${path}/`)) {
            files.delete(existing);
          }
        }
      } else if (typeof entry.content === 'string') {
        files.set(path, { mode, sha: this.#storeBlob(entry.content) });
      } else if (typeof entry.sha === 'string' && this.#blobs.has(entry.sha)) {
        files.set(path, { mode, sha: entry.sha });
      } else {
        return { status: 422, body: { message: `tree entry ${path} has no content or known sha` } };
      }
    }
    return { status: 201, body: { sha: this.#storeTree(files) } };
  }

  #isAncestor(ancestor: string, sha: string): boolean {
    const pending = [sha];
    while (pending.length > 0) {
      const current = pending.pop() ?? '';
      if (current === ancestor) {
        return true;
      }
      pending.push(...(this.#commits.get(current)?.parents ?? []));
    }
    return false;
  }

  #moveBranch(repository: FakeRepository, branch: string, body: unknown): Reply {
    const { sha, force } = body as { sha: string; force?: boolean };
    const current = repository.refs.get(branch);
    if (current === undefined) {
      return { status: 422, body: { message: 'Reference does not exist' } };
    }
    if (!this.#commits.has(sha)) {
      return { status: 422, body: { message: 'Object does not exist' } };
    }
    if (force !== true && !this.#isAncestor(current, sha)) {
      return { status: 422, body: { message: 'Update is not a fast forward' } };
    }
    repository.refs.set(branch, sha);
    return { status: 200, body: { ref: `refs/heads/${branch}`, object: { sha } } };
  }

  #putFile(repository: FakeRepository, path: string, body: unknown): Reply {
    const request = body as { message: string; content: string; branch?: string };
    const branch = request.branch ?? repository.defaultBranch;
    const parent = repository.refs.get(branch);
    const files: TreeFiles = new Map(parent === undefined ? [] : this.#treeOfCommit(parent));
    const content = Buffer.from(request.content, 'base64').toString('utf8');
    files.set(path, { mode: '100644', sha: this.#storeBlob(content) });
    const sha = this.#storeCommit({
      tree: this.#storeTree(files),
      parents: parent === undefined ? [] : [parent],
      message: request.message,
    });
    repository.refs.set(branch, sha);
    return { status: 201, body: { content: { path, sha: gitBlobSha(content) }, commit: { sha } } };
  }

  #pullsPage(repository: FakeRepository, query: URLSearchParams): Reply {
    const state = query.get('state') ?? 'open';
    const perPage = Number(query.get('per_page') ?? 30);
    const page = Number(query.get('page') ?? 1);
    const matching = repository.pulls.filter((pull) => state === 'all' || pull.state === state);
    const items = matching.slice((page - 1) * perPage, page * perPage);
    const headers: Record<string, string> = {};
    if (page * perPage < matching.length) {
      const next = new URL(`${this.url}/repos/${repository.fullName}/pulls`);
      next.search = new URLSearchParams({
        state,
        per_page: String(perPage),
        page: String(page + 1),
      }).toString();
      headers.link = `<${next.href}>; rel="next"`;
    }
    return {
      status: 200,
      headers,
      body: items.map((pull) => ({
        number: pull.number,
        state: pull.state,
        html_url: `https://github.com/${repository.fullName}/pull/${pull.number}`,
        head: { ref: pull.headBranch, repo: { full_name: pull.headRepository } },
      })),
    };
  }
}

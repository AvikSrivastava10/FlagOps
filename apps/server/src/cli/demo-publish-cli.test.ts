import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../../test/helpers/fake-github.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { createLogger } from '../logger.js';
import { listUncommittedPaths, main, readEnvironment } from './demo-publish.js';

// The CLI around publishDemoShop: its variables, the clean-tree refusal, exit codes and logging.
// Tests that need git get a scratch checkout holding a small demo shop under examples/demo-shop.

const repository = 'demo-owner/demo-shop';
const shopPath = 'examples/demo-shop';
const shopFiles: Record<string, string> = {
  '.github/workflows/ci.yml': 'name: CI\n',
  '.gitignore': 'node_modules/\n',
  'README.md': '# Demo shop\n',
  'web/src/main.ts': 'export {};\n',
};

let checkout: string;
let shop: string;

/** Git in the scratch checkout, independent of the machine's identity and signing settings. */
async function git(...args: string[]): Promise<void> {
  const identity = ['-c', 'user.name=Demo publish test', '-c', 'user.email=test@example.invalid'];
  await promisify(execFile)('git', [...identity, '-c', 'commit.gpgsign=false', ...args], {
    cwd: checkout,
  });
}

async function write(relative: string, content: string): Promise<void> {
  const file = path.join(checkout, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function createCheckout(): Promise<void> {
  checkout = await mkdtemp(path.join(tmpdir(), 'flagops-demo-publish-'));
  shop = path.join(checkout, shopPath);
  for (const [file, content] of Object.entries(shopFiles)) {
    await write(`${shopPath}/${file}`, content);
  }
  await write('package.json', '{}\n');
  await git('init', '--quiet');
  await git('add', '.');
  await git('commit', '--quiet', '--message', 'Add the demo shop');
}

async function removeCheckout(): Promise<void> {
  await rm(checkout, { recursive: true, force: true, maxRetries: 3 });
}

describe('readEnvironment', () => {
  const token = 't'.repeat(40);
  const malformed = [
    expect.stringMatching(/^GITHUB_TOKEN must be 20 to 255 characters \(GitHub token with /),
    expect.stringMatching(/^DEMO_REPO must look like owner\/name \(/),
  ];

  it('reports both variables at once when neither is set, or they are blank', () => {
    const missing = [
      'GITHUB_TOKEN is required (GitHub token with Contents, Workflows and Pull requests, all read and write, on DEMO_REPO)',
      'DEMO_REPO is required (owner/name of the demo shop repository)',
    ];

    expect(readEnvironment({}).problems).toEqual(missing);
    expect(readEnvironment({ GITHUB_TOKEN: '  ', DEMO_REPO: '\t' }).problems).toEqual(missing);
  });

  it('reports a malformed token and repository together', () => {
    expect(
      readEnvironment({ GITHUB_TOKEN: 't'.repeat(19), DEMO_REPO: 'demo-shop' }).problems,
    ).toEqual(malformed);
    expect(readEnvironment({ GITHUB_TOKEN: 't'.repeat(256), DEMO_REPO: 'a/b/c' }).problems).toEqual(
      malformed,
    );
  });

  it('accepts a token and repository with surrounding whitespace trimmed', () => {
    expect(readEnvironment({ GITHUB_TOKEN: ` ${token}\n`, DEMO_REPO: ` ${repository} ` })).toEqual({
      token,
      repository,
      problems: [],
    });
  });
});

describe('listUncommittedPaths', () => {
  beforeEach(createCheckout);
  afterEach(removeCheckout);

  it('reports nothing for a committed demo shop', async () => {
    expect(await listUncommittedPaths(shop)).toEqual([]);
  });

  it('names edited, deleted, staged and untracked files of the demo shop, and nothing else', async () => {
    await write(`${shopPath}/README.md`, '# Edited\n');
    await unlink(path.join(shop, 'web/src/main.ts'));
    await write(`${shopPath}/web/src/new file.ts`, 'export {};\n');
    await git('add', '--', `${shopPath}/web/src/new file.ts`);
    await write(`${shopPath}/scratch/deep/notes.txt`, 'scratch\n');
    await write(`${shopPath}/node_modules/package/index.js`, 'ignored\n');
    await write('package.json', '{ "edited": true }\n');
    await write('outside.txt', 'not the demo shop\n');

    expect((await listUncommittedPaths(shop)).sort()).toEqual([
      `${shopPath}/README.md`,
      `${shopPath}/scratch/deep/notes.txt`,
      `${shopPath}/web/src/main.ts`,
      `${shopPath}/web/src/new file.ts`,
    ]);
  });
});

describe('main', () => {
  let github: FakeGitHub;

  beforeEach(async () => {
    await createCheckout();
    github = await FakeGitHub.start();
    github.addRepository(repository);
  });

  afterEach(async () => {
    await github.close();
    await removeCheckout();
  });

  async function run(
    env: NodeJS.ProcessEnv = { GITHUB_TOKEN: github.token, DEMO_REPO: repository },
  ) {
    const logs = captureLogs();
    const code = await main({
      env,
      logger: createLogger('info', logs.destination),
      root: shop,
      github: { baseUrl: github.url, contentIntervalMs: 0, retryDelaysMs: [0, 0] },
    });
    return { code, logs };
  }

  it('publishes a committed demo shop and exits 0', async () => {
    const { code, logs } = await run();

    expect(code).toBe(0);
    expect(github.files(repository)).toEqual(shopFiles);
    expect(logs.entries().at(-1)).toMatchObject({
      level: 30,
      msg: 'DEMO_REPO holds the pristine demo shop',
    });
  });

  it('logs every problem with its variables, exits 1 and sends no request', async () => {
    const { code, logs } = await run({ GITHUB_TOKEN: 'too-short', DEMO_REPO: 'demo-shop' });

    expect(code).toBe(1);
    expect(logs.entries().map((entry) => [entry.level, entry.msg])).toEqual([
      [50, expect.stringMatching(/^GITHUB_TOKEN must be 20 to 255 characters/)],
      [50, expect.stringMatching(/^DEMO_REPO must look like owner\/name/)],
    ]);
    expect(github.requests).toEqual([]);
  });

  it('refuses a demo shop with uncommitted changes, naming them, and sends no request', async () => {
    await write(`${shopPath}/README.md`, '# Edited\n');
    await write(`${shopPath}/notes.txt`, 'scratch\n');

    const { code, logs } = await run();

    const changed = [`${shopPath}/README.md`, `${shopPath}/notes.txt`];
    expect(code).toBe(1);
    expect(logs.entries()).toEqual([expect.objectContaining({ level: 50, paths: changed })]);
    expect(logs.entries()[0]?.msg).toContain(`Commit or remove them first: ${changed.join(', ')}`);
    expect(github.requests).toEqual([]);
  });

  it('logs a missing permission with its code and details, and everything the publish needs', async () => {
    const header = 'contents=write; contents=write,workflows=write';
    github.failNext(
      { method: 'PUT', path: /\/contents\/README\.md$/ },
      {
        status: 403,
        headers: { 'x-accepted-github-permissions': header },
        body: { message: 'Resource not accessible by personal access token' },
      },
    );

    const { code, logs } = await run();

    const failure = logs.entries().find((entry) => entry.level === 50);
    expect(code).toBe(1);
    expect(failure).toMatchObject({
      code: 'github_missing_permission',
      details: { status: 403, permissions: header },
    });
    expect(failure?.msg).toContain(
      'GITHUB_TOKEN needs contents=write, or contents=write and workflows=write.',
    );
    expect(failure?.msg).toContain(
      `The publish as a whole needs Contents, Workflows and Pull requests, all read and write, on ${repository}.`,
    );
    expect(logs.text()).not.toContain(github.token);
  });

  it('logs any other failure with its error and exits 1', async () => {
    await unlink(path.join(shop, 'README.md'));
    await git('commit', '--quiet', '--all', '--message', 'Remove the README');

    const { code, logs } = await run();

    expect(code).toBe(1);
    expect(logs.entries().at(-1)).toMatchObject({
      level: 50,
      msg: 'pnpm demo:publish failed',
      err: { message: 'The demo shop has no README.md to start the empty repository with' },
    });
  });
});

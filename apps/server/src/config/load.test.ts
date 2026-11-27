import path from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.js';

const orgApiKey = 'test-organisation-key-0001';
const minimal = { FLAGSMITH_URL: 'http://localhost:8000', FLAGSMITH_ORG_API_KEY: orgApiKey };

function problemsOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('loadConfig accepted an invalid environment');
}

describe('loadConfig', () => {
  it('applies the documented defaults outside Docker', () => {
    const config = loadConfig(minimal);

    expect(config.http).toEqual({
      port: 3000,
      bind: '127.0.0.1',
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      trustProxy: false,
    });
    expect(config.dataDir).toBe(path.resolve('data'));
    expect(config.logLevel).toBe('info');
    expect(config.flagsmith.orgApiKey.reveal()).toBe(orgApiKey);
    expect(config.flagsmith.projectId).toBeUndefined();
    expect(config.jobs).toEqual({ syncIntervalSeconds: 60 });
  });

  it('uses the image defaults when FLAGOPS_IN_DOCKER is 1', () => {
    const config = loadConfig({ ...minimal, FLAGOPS_IN_DOCKER: '1' });

    expect(config.http.bind).toBe('0.0.0.0');
    expect(config.dataDir).toBe(path.resolve('/data'));
  });

  it('reads every variable it supports', () => {
    const config = loadConfig({
      ...minimal,
      FLAGOPS_PORT: '8080',
      FLAGOPS_BIND: '::',
      FLAGOPS_ALLOWED_HOSTS: ' FlagOps.Example.com , [::1] ',
      FLAGOPS_TRUST_PROXY: 'true',
      FLAGOPS_DATA_DIR: 'state',
      FLAGSMITH_PROJECT_ID: '12',
      FLAGOPS_SYNC_INTERVAL_SECONDS: '15',
      LOG_LEVEL: 'debug',
    });

    expect(config.http).toEqual({
      port: 8080,
      bind: '::',
      allowedHosts: ['flagops.example.com', '[::1]'],
      trustProxy: true,
    });
    expect(config.dataDir).toBe(path.resolve('state'));
    expect(config.logLevel).toBe('debug');
    expect(config.flagsmith.projectId).toBe(12);
    expect(config.jobs.syncIntervalSeconds).toBe(15);
  });

  it.each([
    ['FLAGOPS_SYNC_INTERVAL_SECONDS', '14', 'must be a whole number from 15 to 3600'],
    ['FLAGOPS_SYNC_INTERVAL_SECONDS', '3601', 'must be a whole number from 15 to 3600'],
    ['FLAGSMITH_PROJECT_ID', '0', 'must be a whole number from 1 to 2147483647'],
    ['FLAGSMITH_PROJECT_ID', 'one', 'must be a whole number from 1 to 2147483647'],
  ])('rejects %s=%s', (name, value, problem) => {
    expect(problemsOf({ ...minimal, [name]: value })[0]).toMatch(
      new RegExp(`^${name} ${problem} \\(`),
    );
  });

  it('freezes the config', () => {
    const config = loadConfig(minimal);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.flagsmith)).toBe(true);
    expect(Object.isFrozen(config.http)).toBe(true);
    expect(Object.isFrozen(config.http.allowedHosts)).toBe(true);
  });

  it('names FLAGSMITH_URL when it is missing', () => {
    expect(problemsOf({ FLAGSMITH_ORG_API_KEY: orgApiKey })).toEqual([
      'FLAGSMITH_URL is required (URL of your Flagsmith API)',
    ]);
  });

  it('treats an empty or blank value as not set', () => {
    expect(problemsOf({ ...minimal, FLAGSMITH_URL: '   ', FLAGOPS_PORT: '' })).toEqual([
      'FLAGSMITH_URL is required (URL of your Flagsmith API)',
    ]);
  });

  it('reports every invalid variable at once, each by name', () => {
    const problems = problemsOf({
      FLAGSMITH_URL: 'localhost:8000',
      FLAGSMITH_INTERNAL_URL: 'http://user:secret@flagsmith:8000',
      FLAGOPS_IN_DOCKER: 'true',
      FLAGOPS_PORT: '0',
      FLAGOPS_BIND: 'localhost',
      FLAGOPS_ALLOWED_HOSTS: 'localhost:3000',
      FLAGOPS_TRUST_PROXY: 'yes',
      FLAGSMITH_PROJECT_ID: '-1',
      FLAGOPS_SYNC_INTERVAL_SECONDS: '5',
      LOG_LEVEL: 'verbose',
    });

    expect(problems.map((problem) => problem.split(' ')[0])).toEqual([
      'FLAGSMITH_URL',
      'FLAGSMITH_INTERNAL_URL',
      'FLAGSMITH_ORG_API_KEY',
      'FLAGSMITH_PROJECT_ID',
      'FLAGOPS_IN_DOCKER',
      'FLAGOPS_PORT',
      'FLAGOPS_BIND',
      'FLAGOPS_ALLOWED_HOSTS',
      'FLAGOPS_TRUST_PROXY',
      'FLAGOPS_SYNC_INTERVAL_SECONDS',
      'LOG_LEVEL',
    ]);
    expect(problems).toContain(
      'FLAGOPS_PORT must be a whole number from 1 to 65535 (port FlagOps listens on)',
    );
  });

  it.each(['ftp://flagsmith:8000', 'http://flagsmith:8000/?x=1', 'http://flagsmith:8000/#top'])(
    'rejects %s as a Flagsmith URL',
    (url) => {
      expect(problemsOf({ ...minimal, FLAGSMITH_URL: url })).toEqual([
        'FLAGSMITH_URL must be an http or https URL without credentials, query or fragment (URL of your Flagsmith API)',
      ]);
    },
  );

  it.each(['too-short-key', 'contains a space in the organisation key'])(
    'rejects the organisation key "%s" without repeating it',
    (key) => {
      const problems = problemsOf({ ...minimal, FLAGSMITH_ORG_API_KEY: key });

      expect(problems).toEqual([
        'FLAGSMITH_ORG_API_KEY must be 20 to 128 characters without spaces (organisation API key of the Flagsmith organisation FlagOps manages)',
      ]);
      expect(problems.join()).not.toContain(key);
    },
  );

  it('never shows the organisation key when the config is serialised, printed or inspected', () => {
    const config = loadConfig(minimal);

    expect(JSON.stringify(config)).not.toContain(orgApiKey);
    expect(inspect(config, { depth: null })).not.toContain(orgApiKey);
    expect(String(config.flagsmith.orgApiKey)).not.toContain(orgApiKey);
  });
});

describe('Flagsmith URLs', () => {
  it('sends requests to FLAGSMITH_INTERNAL_URL when it is set, also in Docker', () => {
    const { flagsmith } = loadConfig({
      ...minimal,
      FLAGOPS_IN_DOCKER: '1',
      FLAGSMITH_INTERNAL_URL: 'http://flagsmith:8000',
    });

    expect(flagsmith).toMatchObject({
      dashboardUrl: 'http://localhost:8000',
      requestUrl: 'http://flagsmith:8000',
      rewrittenForDocker: false,
    });
  });

  it.each([
    ['http://localhost:8000', 'http://host.docker.internal:8000'],
    ['http://127.0.0.1:8000', 'http://host.docker.internal:8000'],
    ['http://[::1]:8000', 'http://host.docker.internal:8000'],
    ['https://LOCALHOST/flagsmith/', 'https://host.docker.internal/flagsmith'],
  ])('rewrites the loopback URL %s to %s inside Docker', (url, rewritten) => {
    const { flagsmith } = loadConfig({ ...minimal, FLAGSMITH_URL: url, FLAGOPS_IN_DOCKER: '1' });

    expect(flagsmith.requestUrl).toBe(rewritten);
    expect(flagsmith.rewrittenForDocker).toBe(true);
  });

  it.each([{ FLAGOPS_IN_DOCKER: '0' }, {}])(
    'does not rewrite a loopback URL outside Docker (%o)',
    (docker) => {
      const { flagsmith } = loadConfig({ ...minimal, ...docker });

      expect(flagsmith.requestUrl).toBe('http://localhost:8000');
      expect(flagsmith.rewrittenForDocker).toBe(false);
    },
  );

  it('does not rewrite a host that is not loopback, also in Docker', () => {
    const { flagsmith } = loadConfig({
      ...minimal,
      FLAGSMITH_URL: 'https://flagsmith.example.com',
      FLAGOPS_IN_DOCKER: '1',
    });

    expect(flagsmith.requestUrl).toBe('https://flagsmith.example.com');
    expect(flagsmith.rewrittenForDocker).toBe(false);
  });

  it.each([
    [{ FLAGOPS_IN_DOCKER: '1' }],
    [{ FLAGOPS_IN_DOCKER: '1', FLAGSMITH_INTERNAL_URL: 'http://flagsmith:8000' }],
    [{}],
  ])('keeps FLAGSMITH_URL for dashboard links (%o)', (extra) => {
    const { flagsmith } = loadConfig({
      ...minimal,
      FLAGSMITH_URL: 'http://localhost:8000/',
      ...extra,
    });

    expect(flagsmith.dashboardUrl).toBe('http://localhost:8000');
  });
});

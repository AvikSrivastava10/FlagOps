import path from 'node:path';
import type { z } from 'zod';
import { envSchema, variableDescriptions, type LogLevel, type VariableName } from './env.js';
import { resolveFlagsmithUrls, type FlagsmithUrls } from './flagsmith-urls.js';
import { Secret } from './secret.js';

/** A configuration problem the operator must fix before FlagOps can start. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export type Config = Readonly<{
  flagsmith: Readonly<
    FlagsmithUrls & {
      orgApiKey: Secret;
      /** `FLAGSMITH_PROJECT_ID`; without it, FlagOps manages the organisation's only project. */
      projectId: number | undefined;
    }
  >;
  http: Readonly<{
    port: number;
    bind: string;
    allowedHosts: readonly string[];
    trustProxy: boolean;
  }>;
  jobs: Readonly<{ syncIntervalSeconds: number }>;
  /**
   * GitHub access for scanning and Retire. Without a usable token or any repository, `problem`
   * says why both are disabled; FlagOps still starts (architecture.md 21).
   */
  github: Readonly<{
    token: Secret | undefined;
    repositories: readonly string[];
    problem: string | undefined;
  }>;
  dataDir: string;
  logLevel: LogLevel;
}>;

function githubConfig(
  token: string | undefined,
  repositories: readonly string[],
): Config['github'] {
  const problem = githubProblem(token, repositories);
  return Object.freeze({
    token: problem === undefined && token !== undefined ? new Secret(token) : undefined,
    repositories: Object.freeze([...repositories]),
    problem,
  });
}

function githubProblem(
  token: string | undefined,
  repositories: readonly string[],
): string | undefined {
  if (token === undefined) {
    return `GITHUB_TOKEN is not set (${variableDescriptions.GITHUB_TOKEN})`;
  }
  if (token.length < 20 || token.length > 255) {
    return `GITHUB_TOKEN must be 20 to 255 characters (${variableDescriptions.GITHUB_TOKEN})`;
  }
  return repositories.length === 0
    ? `GITHUB_REPOSITORIES is not set (${variableDescriptions.GITHUB_REPOSITORIES})`
    : undefined;
}

const defaultAllowedHosts: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

function isVariableName(key: PropertyKey | undefined): key is VariableName {
  return typeof key === 'string' && Object.hasOwn(variableDescriptions, key);
}

function describe(issue: z.core.$ZodIssue): string {
  const [name] = issue.path;
  return isVariableName(name)
    ? `${name} ${issue.message} (${variableDescriptions[name]})`
    : issue.message;
}

/**
 * Parses and validates the environment once at startup (architecture.md 21). Every problem is
 * reported at once, each naming its variable, so one restart is enough to fix them all.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map(describe));
  }
  const vars = parsed.data;
  const inDocker = vars.FLAGOPS_IN_DOCKER ?? false;
  const urls = resolveFlagsmithUrls({
    flagsmithUrl: vars.FLAGSMITH_URL,
    internalUrl: vars.FLAGSMITH_INTERNAL_URL,
    inDocker,
  });
  return Object.freeze({
    flagsmith: Object.freeze({
      ...urls,
      orgApiKey: vars.FLAGSMITH_ORG_API_KEY,
      projectId: vars.FLAGSMITH_PROJECT_ID,
    }),
    http: Object.freeze({
      port: vars.FLAGOPS_PORT ?? 3000,
      bind: vars.FLAGOPS_BIND ?? (inDocker ? '0.0.0.0' : '127.0.0.1'),
      allowedHosts: Object.freeze(vars.FLAGOPS_ALLOWED_HOSTS ?? defaultAllowedHosts),
      trustProxy: vars.FLAGOPS_TRUST_PROXY ?? false,
    }),
    jobs: Object.freeze({ syncIntervalSeconds: vars.FLAGOPS_SYNC_INTERVAL_SECONDS ?? 60 }),
    github: githubConfig(vars.GITHUB_TOKEN, vars.GITHUB_REPOSITORIES ?? []),
    dataDir: path.resolve(vars.FLAGOPS_DATA_DIR ?? (inDocker ? '/data' : 'data')),
    logLevel: vars.LOG_LEVEL ?? 'info',
  });
}

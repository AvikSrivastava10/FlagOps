import path from 'node:path';
import type { z } from 'zod';
import { envSchema, variableDescriptions, type LogLevel, type VariableName } from './env.js';
import { resolveFlagsmithUrls, type FlagsmithUrls } from './flagsmith-urls.js';
import type { Secret } from './secret.js';

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
  flagsmith: Readonly<FlagsmithUrls & { orgApiKey: Secret }>;
  http: Readonly<{
    port: number;
    bind: string;
    allowedHosts: readonly string[];
    trustProxy: boolean;
  }>;
  dataDir: string;
  logLevel: LogLevel;
}>;

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
    flagsmith: Object.freeze({ ...urls, orgApiKey: vars.FLAGSMITH_ORG_API_KEY }),
    http: Object.freeze({
      port: vars.FLAGOPS_PORT ?? 3000,
      bind: vars.FLAGOPS_BIND ?? (inDocker ? '0.0.0.0' : '127.0.0.1'),
      allowedHosts: Object.freeze(vars.FLAGOPS_ALLOWED_HOSTS ?? defaultAllowedHosts),
      trustProxy: vars.FLAGOPS_TRUST_PROXY ?? false,
    }),
    dataDir: path.resolve(vars.FLAGOPS_DATA_DIR ?? (inDocker ? '/data' : 'data')),
    logLevel: vars.LOG_LEVEL ?? 'info',
  });
}

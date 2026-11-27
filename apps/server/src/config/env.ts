import { isIP } from 'node:net';
import { z } from 'zod';
import { formatBaseUrl } from './flagsmith-urls.js';
import { Secret } from './secret.js';

/**
 * What each variable is for (architecture.md 21). Startup errors quote it, so the operator knows
 * what to set without opening the docs.
 */
export const variableDescriptions = {
  FLAGSMITH_URL: 'URL of your Flagsmith API',
  FLAGSMITH_INTERNAL_URL:
    "URL for FlagOps' own requests to Flagsmith, when it differs from FLAGSMITH_URL",
  FLAGSMITH_ORG_API_KEY: 'organisation API key of the Flagsmith organisation FlagOps manages',
  FLAGSMITH_PROJECT_ID:
    'ID of the Flagsmith project FlagOps manages, needed when the organisation has several',
  FLAGOPS_IN_DOCKER: 'set to 1 by the FlagOps image',
  FLAGOPS_PORT: 'port FlagOps listens on',
  FLAGOPS_BIND: 'IP address FlagOps listens on',
  FLAGOPS_ALLOWED_HOSTS: 'hostnames that browsers use to reach FlagOps',
  FLAGOPS_TRUST_PROXY: 'whether FlagOps runs behind a reverse proxy that sets X-Forwarded headers',
  FLAGOPS_DATA_DIR: "directory for FlagOps' database",
  FLAGOPS_SYNC_INTERVAL_SECONDS: 'seconds between syncs from Flagsmith',
  LOG_LEVEL: 'how much FlagOps logs',
} as const;

export type VariableName = keyof typeof variableDescriptions;

export const logLevels = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof logLevels)[number];

/**
 * An unset, empty or blank variable counts as absent: a copied `.env.example` has empty values, and
 * Docker passes an env file's empty lines through as empty strings.
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function required<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema);
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

const text = z.string({ error: 'is required' });

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  // Credentials in the URL would end up in logs and links.
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}

const httpUrl = text
  .refine(isHttpUrl, 'must be an http or https URL without credentials, query or fragment')
  .transform((value) => formatBaseUrl(new URL(value)));

const apiKey = text
  .regex(/^\S{20,128}$/, 'must be 20 to 128 characters without spaces')
  .transform((value) => new Secret(value));

/** A whole number within the limits of architecture.md 21. */
function wholeNumber(min: number, max: number) {
  return text
    .refine(
      (value) => /^\d{1,10}$/.test(value) && Number(value) >= min && Number(value) <= max,
      `must be a whole number from ${min} to ${max}`,
    )
    .transform(Number);
}

const port = wholeNumber(1, 65535);

const ipAddress = text.refine(
  (value) => isIP(value) !== 0,
  'must be an IP address, such as 127.0.0.1 or 0.0.0.0',
);

/** A hostname or IP address without a port; IPv6 addresses in brackets, as browsers send them. */
const hostnamePattern = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/;

const hostnames = text
  .transform((value) => value.split(',').map((host) => host.trim().toLowerCase()))
  .refine(
    (hosts) => hosts.every((host) => hostnamePattern.test(host)),
    'must be comma-separated hostnames without ports; write IPv6 addresses in brackets, such as [::1]',
  );

const zeroOrOne = z
  .enum(['0', '1'], { error: 'must be 0 or 1' })
  .transform((value) => value === '1');

const trueOrFalse = z
  .enum(['true', 'false'], { error: 'must be true or false' })
  .transform((value) => value === 'true');

export const envSchema = z.object({
  FLAGSMITH_URL: required(httpUrl),
  FLAGSMITH_INTERNAL_URL: optional(httpUrl),
  FLAGSMITH_ORG_API_KEY: required(apiKey),
  FLAGSMITH_PROJECT_ID: optional(wholeNumber(1, 2_147_483_647)),
  FLAGOPS_IN_DOCKER: optional(zeroOrOne),
  FLAGOPS_PORT: optional(port),
  FLAGOPS_BIND: optional(ipAddress),
  FLAGOPS_ALLOWED_HOSTS: optional(hostnames),
  FLAGOPS_TRUST_PROXY: optional(trueOrFalse),
  FLAGOPS_DATA_DIR: optional(text),
  FLAGOPS_SYNC_INTERVAL_SECONDS: optional(wholeNumber(15, 3600)),
  LOG_LEVEL: optional(z.enum(logLevels, { error: 'must be error, warn, info or debug' })),
} satisfies Record<VariableName, z.ZodType>);

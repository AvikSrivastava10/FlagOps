import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config/env.js';

const secretKeys = ['password', 'token', 'key', 'apiKey', 'ephemeral_token'];

/**
 * Paths pino replaces with "[Redacted]" (architecture.md 18.3). Request bodies and outbound headers
 * are never logged at all; these paths catch credentials inside objects passed to a log call, at
 * the top level, as in Flagsmith's login response `{key}`, and one level down.
 */
const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...secretKeys,
  ...secretKeys.map((key) => `*.${key}`),
];

/** JSON lines on stdout, or on `destination` when given (tests capture the output that way). */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino({ level, redact: redactedPaths }, destination);
}

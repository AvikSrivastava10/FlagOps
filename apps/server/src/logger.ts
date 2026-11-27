import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config/env.js';

/**
 * Paths pino replaces with "[Redacted]" (architecture.md 18.3). Request bodies and outbound headers
 * are never logged at all; these paths catch credentials inside objects passed to a log call.
 */
const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.key',
  '*.apiKey',
  '*.ephemeral_token',
];

/** JSON lines on stdout, or on `destination` when given (tests capture the output that way). */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino({ level, redact: redactedPaths }, destination);
}

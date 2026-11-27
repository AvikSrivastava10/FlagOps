import type { DestinationStream } from 'pino';

export type CapturedLogs = {
  /** Give this to createLogger; pino writes each JSON line to it synchronously. */
  destination: DestinationStream;
  /** Everything logged so far, exactly as it would reach stdout. */
  text(): string;
  entries(): Record<string, unknown>[];
};

export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  return {
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
    text: () => lines.join(''),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

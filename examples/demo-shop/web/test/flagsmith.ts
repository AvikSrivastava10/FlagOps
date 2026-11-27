import type { ReactNode } from 'react';

// Tests replace the Flagsmith SDK modules with these stand-ins (vi.mock), so they never reach
// Flagsmith. Every stand-in reads the same served flags.

type ServedFlag = { enabled: boolean; value?: string | number | boolean | null };

let served: Record<string, ServedFlag> = {};

/** Sets the flags the stand-ins serve. A flag left out is off with no value. */
export function serveFlags(flags: Record<string, ServedFlag>): void {
  served = flags;
}

function read(name: string) {
  const flag = served[name];
  return { enabled: flag?.enabled ?? false, value: flag?.value ?? null };
}

const client = {
  hasFeature: (name: string) => read(name).enabled,
  getValue: (name: string) => read(name).value,
};

/** Stands in for `@flagsmith/flagsmith`, whose default export is the client. */
export const clientModule = { default: client };

/** Stands in for `@flagsmith/flagsmith/react`. */
export const reactModule = {
  FlagsmithProvider: ({ children }: { children: ReactNode }) => children,
  useFlagsmith: () => client,
  useFlags: (names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [name, read(name)])),
};

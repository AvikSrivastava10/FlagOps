import { useFlags } from '@flagsmith/flagsmith/react';

/**
 * Whether a flag is on for the current user. Components that only need the on or off state read
 * flags through this hook; it re-renders them when Flagsmith sends new flags.
 */
export function useFeature(name: string): boolean {
  const flags = useFlags([name]);
  return flags[name].enabled;
}

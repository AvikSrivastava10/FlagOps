import { useFlags } from '@flagsmith/flagsmith/react';
/** Declared as flags-object, but it reads one name instead of passing its list on. */
export function useFlagList(name: string) {
  return useFlags([name]);
}

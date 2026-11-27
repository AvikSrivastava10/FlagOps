import { useFlags } from '@flagsmith/flagsmith/react';

export function useFlag(name: string): boolean {
  const all = useFlags([name]);
  return all[name].enabled;
}

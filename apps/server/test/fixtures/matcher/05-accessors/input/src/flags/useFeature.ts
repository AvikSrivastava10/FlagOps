import { useFlags } from '@flagsmith/flagsmith/react';

export function useFeature(name: string): boolean {
  const flags = useFlags([name]);
  return flags[name].enabled;
}

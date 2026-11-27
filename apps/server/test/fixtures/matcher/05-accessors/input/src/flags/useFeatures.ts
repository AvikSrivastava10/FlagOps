import { useFlags } from '@flagsmith/flagsmith/react';
export function useFeatures(names: string[]) {
  return useFlags(names);
}

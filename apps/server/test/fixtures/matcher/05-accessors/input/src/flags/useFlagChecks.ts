import { useFlagsmith } from '@flagsmith/flagsmith/react';

export function useFlagChecks() {
  const flagsmith = useFlagsmith();
  return { isEnabled: (name: string): boolean => flagsmith.hasFeature(name) };
}

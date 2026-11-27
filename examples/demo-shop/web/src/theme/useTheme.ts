import { useFlags } from '@flagsmith/flagsmith/react';

export type Theme = 'light' | 'dark';

/** The colour theme. Users in the dark-mode rollout get the dark theme. */
export function useTheme(): Theme {
  const { dark_mode } = useFlags(['dark_mode']);
  return dark_mode.enabled ? 'dark' : 'light';
}

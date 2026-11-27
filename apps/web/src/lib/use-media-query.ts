import { useCallback, useSyncExternalStore } from 'react';

/** Narrow screens, below 720px (ui-design.md 3.3). The same width as the narrow rule in tokens.css. */
export const narrowQuery = '(max-width: 719.98px)';

/** Whether a media query matches. Follows changes live. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

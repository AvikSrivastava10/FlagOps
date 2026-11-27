import { useMediaQuery } from './use-media-query';

/** Whether the operator asked for reduced motion (ui-design.md 3.4). Follows changes live. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

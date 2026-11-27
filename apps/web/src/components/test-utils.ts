import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

type Media = { reducedMotion: boolean; narrow: boolean };

/**
 * Prepares a component test file: unmounts after each test, and installs a controllable
 * `window.matchMedia`, which jsdom does not implement and which useReducedMotion and
 * useMediaQuery call. The web Vitest project has no setup file, so each test file calls this.
 */
export function setUpComponentTests(initial: Partial<Media> = {}) {
  const media: Media = { reducedMotion: false, narrow: false, ...initial };
  const listeners = new Set<() => void>();
  const matches = (query: string) =>
    query.includes('prefers-reduced-motion') ? media.reducedMotion : media.narrow;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        media: query,
        get matches() {
          return matches(query);
        },
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });

  afterEach(() => {
    cleanup();
    Object.assign(media, { reducedMotion: false, narrow: false, ...initial });
  });

  return {
    /** Changes what the media queries report, and notifies the components listening. */
    setMedia(next: Partial<Media>) {
      Object.assign(media, next);
      for (const listener of listeners) listener();
    },
  };
}

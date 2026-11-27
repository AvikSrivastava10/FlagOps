import type { ReactElement } from 'react';

/**
 * The FlagOps icon set (ui-design.md 4): drawn on a 20px grid with 2px strokes and square caps.
 * Icon renders the stroke and colour; a glyph only fills a shape where the drawing needs it.
 */
export const glyphs = {
  // Diagram
  'station-tick': <path d="M2 12H18M10 12V5" />,
  'interchange-ring': (
    <>
      <path d="M2 10H4.5M15.5 10H18" />
      <circle cx="10" cy="10" r="4.5" />
    </>
  ),
  'terminus-bar': <path d="M2 10H15M16 4V16" />,
  'branch-join': <path d="M2 6H18M5 6L11 12H18" />,

  // Lamps: the shape carries the state, the colour only reinforces it.
  'lamp-on': <circle cx="10" cy="10" r="6" fill="currentColor" />,
  'lamp-partial': (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M10 4A6 6 0 0 0 10 16Z" fill="currentColor" stroke="none" />
    </>
  ),
  'lamp-off': <circle cx="10" cy="10" r="6" />,

  // Notices, one per health condition
  'stuck-rollout': <path d="M5 3H15M5 17H15M6 3L14 17M14 3L6 17" />,
  'inverted-drift': <path d="M3 7H16M13 4L16 7L13 10M17 13H4M7 10L4 13L7 16" />,
  'zombie-reference': <path d="M16 10A6 6 0 1 1 14.24 5.76" />,
  ghost: <circle cx="10" cy="10" r="7" strokeDasharray="2.75 2.75" strokeLinecap="butt" />,
  'reused-name': (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
    </>
  ),
  'missing-exit-plan': (
    <path d="M10 2L18 10L10 18L2 10ZM8.25 8.6A1.8 1.8 0 1 1 10.75 10.2C10.3 10.45 10 10.8 10 11.4M10 14V14.2" />
  ),

  // Actions
  promote: <path d="M2 16H8V9H16M13 6L16 9L13 12" />,
  retire: <path d="M2 10H13M10 7L13 10L10 13M17 4V16" />,
  'roll-back': <path d="M16 17V9A5 5 0 0 0 6 9V13M3 10L6 13L9 10" />,
  archive: <path d="M2 4H18V8H2ZM4 8V17H16V8M10 10.5V14.5M7.5 12L10 14.5L12.5 12" />,
  external: <path d="M9 4H4V16H16V11M12 4H16V8M16 4L9 11" />,
  sync: (
    <path d="M15.5 7.5A6 6 0 0 0 4.6 7M15.5 3.5V7.5H11.5M4.5 12.5A6 6 0 0 0 15.4 13M4.5 16.5V12.5H8.5" />
  ),
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5L17 17" />
    </>
  ),
  filter: <path d="M3 5H17M6 10H14M9 15H11" />,
  close: <path d="M5 5L15 15M15 5L5 15" />,
  'chevron-up': <path d="M5 12L10 7L15 12" />,
  'chevron-down': <path d="M5 8L10 13L15 8" />,
  'chevron-left': <path d="M12 5L7 10L12 15" />,
  'chevron-right': <path d="M8 5L13 10L8 15" />,

  // Drift markers (ui-design.md 6.5): an arrow pointing back or forward along the line.
  'arrow-back': <path d="M17 10H4M8 6L4 10L8 14" />,
  'arrow-forward': <path d="M3 10H16M12 6L16 10L12 14" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof glyphs;

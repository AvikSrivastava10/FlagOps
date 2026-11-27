import { createElement, type HTMLAttributes } from 'react';

/** The heading levels a component's title can take; the screen's own title is the h1. */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & { level: HeadingLevel };

/**
 * A heading at the level the screen chooses, so a component's title fits the screen's outline.
 * Components style their headings with classes, so the level changes no look.
 */
export function Heading({ level, ...props }: HeadingProps) {
  return createElement(`h${level}`, props);
}

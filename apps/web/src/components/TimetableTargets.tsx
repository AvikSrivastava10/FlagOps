import type { FocusEvent, ReactNode } from 'react';
import type { RovingItemProps } from '../lib/roving-focus';
import { DriftMarker, servesMoreLaterTip } from './DriftMarker';
import { Link } from './Link';
import { Tooltip, type TooltipTriggerProps } from './Tooltip';
import type { TimetableDrift } from './timetable-data';
import styles from './Timetable.module.css';

type TargetProps = {
  href?: string | undefined;
  roving: RovingItemProps;
  children: ReactNode;
  /** Set when the target also triggers a tooltip. */
  tooltip?: TooltipTriggerProps | undefined;
};

/**
 * One roving item of the timetable: a link when it opens something, otherwise a focusable span,
 * so the arrow keys reach every cell and every marker.
 */
export function Target({ href, roving, children, tooltip }: TargetProps) {
  const shared = {
    ...tooltip,
    className: styles.target,
    tabIndex: roving.tabIndex,
    'data-roving': roving['data-roving'],
    onFocus: (event: FocusEvent<HTMLElement>) => {
      roving.onFocus(event);
      tooltip?.onFocus();
    },
  };
  return href === undefined ? (
    <span {...shared}>{children}</span>
  ) : (
    <Link {...shared} href={href}>
      {children}
    </Link>
  );
}

/** A drift marker as a roving item; "serves more later" explains itself in a tooltip. */
export function MarkerTarget({
  drift,
  pair,
  roving,
}: {
  drift: TimetableDrift;
  /** "Development to Staging". */
  pair: string;
  roving: RovingItemProps;
}) {
  const content = (
    <>
      <span className="visually-hidden">{pair}: </span>
      <DriftMarker category={drift.category} />
    </>
  );
  if (drift.category !== 'later_serves_more') {
    return (
      <Target href={drift.href} roving={roving}>
        {content}
      </Target>
    );
  }
  return (
    <Tooltip text={servesMoreLaterTip}>
      {(trigger) => (
        <Target href={drift.href} roving={roving} tooltip={trigger}>
          {content}
        </Target>
      )}
    </Tooltip>
  );
}

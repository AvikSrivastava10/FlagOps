import type { CSSProperties } from 'react';
import { cx } from '../lib/class-names';
import styles from './ZoneBand.module.css';

/** Flagsmith's own lifecycle stages, drawn as fare zones behind the stations (ui-design.md 2). */
export const flagsmithZones = ['new', 'live', 'stale', 'to_remove', 'permanent'] as const;

export type FlagsmithZone = (typeof flagsmithZones)[number];

const zoneNames: Readonly<Record<FlagsmithZone, string>> = {
  new: 'new',
  live: 'live',
  stale: 'stale',
  to_remove: 'to remove',
  permanent: 'permanent',
};

/** "Flagsmith: live"; the sign face shows it in capitals. */
export function zoneLabel(zone: FlagsmithZone): string {
  return `Flagsmith: ${zoneNames[zone]}`;
}

export type ZoneBandProps = {
  zone: FlagsmithZone;
  /** Placement in the diagram's grid. */
  style?: CSSProperties | undefined;
  className?: string | undefined;
};

/**
 * Tinted band behind the stations of one Flagsmith zone, labelled in small sign type
 * ("FLAGSMITH: LIVE", ui-design.md 5). It is decoration with a text label: the stations inside
 * it carry the content.
 */
export function ZoneBand({ zone, style, className }: ZoneBandProps) {
  return (
    <div className={cx(styles.band, className)} data-zone={zone} style={style}>
      <span className={styles.label}>{zoneLabel(zone)}</span>
    </div>
  );
}

/** The same zone as an inline tag, for the evidence card and the flag page header. */
export function ZoneTag({ zone }: { zone: FlagsmithZone }) {
  return (
    <span className={styles.tag} data-zone={zone}>
      {zoneLabel(zone)}
    </span>
  );
}

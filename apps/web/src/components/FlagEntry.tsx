import { healthLabels, type FlagType, type HealthId } from '@flagops/shared';
import { useId, useState } from 'react';
import { cx } from '../lib/class-names';
import type { RovingItemProps } from '../lib/roving-focus';
import { useChangeMarker } from '../lib/use-change-marker';
import { useHoverFocus } from '../lib/use-hover-focus';
import { ChangedMarker } from './ChangedMarker';
import { EvidenceCard, type EvidenceCardData } from './EvidenceCard';
import { FlagName } from './FlagName';
import { Icon } from './icons/Icon';
import { healthGlyphs } from './icons/health';
import { Link } from './Link';
import { RouteBullet } from './RouteBullet';
import styles from './FlagEntry.module.css';

/** One flag at a station: what the entry shows, and what its evidence card shows. */
export type FlagEntryData = EvidenceCardData & {
  /** Stable across syncs, such as the Flagsmith feature ID. */
  id: string;
  name: string;
  type: FlagType | null;
  health: readonly HealthId[];
  /** The flag page. */
  href: string;
};

export type FlagEntryProps = FlagEntryData & {
  /** Set by the line diagram or the strip map, which make the board one tab stop. */
  roving?: RovingItemProps | undefined;
  /**
   * Set by the line diagram or the strip map when the entry mounts because the flag has just
   * moved to this station after a sync. Read when the entry mounts.
   */
  arrived?: boolean | undefined;
};

/**
 * Compact entry inside a station (ui-design.md 5): route bullet, flag name and notice glyphs. The
 * name wraps after underscores, so it never clips. Hover or focus highlights the bullet and opens
 * the evidence card, which describes the entry; Enter or a click opens the flag page. An entry that
 * arrived after a sync slides in once, or shows the static "Changed" marker under reduced motion.
 */
export function FlagEntry({ roving, arrived = false, ...flag }: FlagEntryProps) {
  const cardId = useId();
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null);
  const { open, triggerProps, contentProps } = useHoverFocus();
  const { animate, showMarker } = useChangeMarker(null, arrived);
  return (
    <li className={styles.entry}>
      <Link
        href={flag.href}
        ref={setAnchor}
        className={styles.link}
        aria-describedby={cardId}
        tabIndex={roving?.tabIndex}
        data-roving={roving?.['data-roving']}
        data-flag-entry=""
        onMouseEnter={triggerProps.onMouseEnter}
        onMouseLeave={triggerProps.onMouseLeave}
        onBlur={triggerProps.onBlur}
        onFocus={(event) => {
          roving?.onFocus(event);
          triggerProps.onFocus();
        }}
      >
        {/* A moved flag mounts a new entry at its new station, so the slide plays once. */}
        <span className={cx(styles.body, animate && styles.arrived)}>
          <RouteBullet type={flag.type} highlighted={open} />
          <FlagName name={flag.name} className={styles.name} />
          {flag.health.length > 0 && (
            <span className={styles.glyphs}>
              {flag.health.map((condition) => (
                <Icon
                  key={condition}
                  name={healthGlyphs[condition]}
                  label={healthLabels[condition]}
                />
              ))}
            </span>
          )}
          {showMarker && <ChangedMarker />}
        </span>
      </Link>
      <EvidenceCard
        id={cardId}
        flagName={flag.name}
        anchor={anchor}
        open={open}
        evidence={flag.evidence}
        history={flag.history}
        owners={flag.owners}
        zone={flag.zone}
        {...contentProps}
      />
    </li>
  );
}

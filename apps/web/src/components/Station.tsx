import { stageLabels, type StageId } from '@flagops/shared';
import { useId } from 'react';
import { cx } from '../lib/class-names';
import type { RovingItemProps } from '../lib/roving-focus';
import { FlagEntry, type FlagEntryData } from './FlagEntry';
import { FlapText } from './FlapText';
import { ZoneTag, type FlagsmithZone } from './ZoneBand';
import styles from './Station.module.css';

export type StationProps = {
  stage: StageId;
  flags: readonly FlagEntryData[];
  /** While the board loads, the plate shows "Loading" flap text instead of a list (ui-design.md 6.3). */
  loading?: boolean | undefined;
  /** `column` on the line diagram, `strip` on the narrow strip map. */
  layout?: 'column' | 'strip' | undefined;
  /** Shown as a tag on the strip map, where no zone band runs behind the stations. */
  zone?: FlagsmithZone | null | undefined;
  /** Props of the station's roving items: item 0 is the plate, the flags follow. */
  roving?: ((item: number) => RovingItemProps) | undefined;
};

/**
 * A station of the line (ui-design.md 5): its name plate in sign type, ink on paper with a 2px
 * rule, the count, and the flags at the stage. The section is labelled by its plate, and the
 * flags are a list (ui-design.md 8). Long lists scroll inside the station, below the plate.
 */
export function Station({
  stage,
  flags,
  loading = false,
  layout = 'column',
  zone = null,
  roving,
}: StationProps) {
  const plateId = useId();
  const count = flags.length;
  const plateRoving = roving?.(0);
  return (
    <section
      className={cx(styles.station, styles[layout])}
      aria-labelledby={plateId}
      aria-busy={loading || undefined}
      data-stage={stage}
    >
      <h3
        id={plateId}
        className={styles.plate}
        tabIndex={plateRoving?.tabIndex}
        data-roving={plateRoving?.['data-roving']}
        onFocus={plateRoving?.onFocus}
      >
        <span className={styles.name}>{stageLabels[stage]}</span>
        {!loading && (
          <span className={styles.count} data-station-count="">
            {count}
            <span className="visually-hidden">{count === 1 ? ' flag' : ' flags'}</span>
          </span>
        )}
      </h3>
      {layout === 'strip' && zone !== null && <ZoneTag zone={zone} />}
      {loading ? (
        <p className={styles.status}>
          <FlapText text="Loading" />
        </p>
      ) : count === 0 ? (
        <p className={styles.status}>No flags</p>
      ) : (
        <ul className={styles.list}>
          {flags.map((flag, index) => (
            <FlagEntry key={flag.id} {...flag} roving={roving?.(index + 1)} />
          ))}
        </ul>
      )}
    </section>
  );
}

import { cx } from '../lib/class-names';
import { moveInStations, useRovingFocus } from '../lib/roving-focus';
import { stationOrder, stationZones, type BoardStations, type StationStage } from './board-layout';
import { Station } from './Station';
import styles from './StripMap.module.css';

export type StripMapProps = {
  stations: BoardStations;
  loading?: boolean | undefined;
  label?: string | undefined;
};

/** The two side lines, shown as labelled side sections after Released (ui-design.md 6.3). */
const sideLines: Readonly<Partial<Record<StationStage, string>>> = {
  permanent: 'Loop, no terminus',
  abandoned: 'Spur from In development to Cleanup PR open',
};

/**
 * The line for narrow screens, like the strip maps inside train cars (ui-design.md 5): stations
 * from top to bottom with their flags indented under each, Permanent and Abandoned as side
 * sections after Released, and the Archived terminus at the end. Keys work as on the line diagram.
 */
export function StripMap({ stations, loading = false, label = 'Lifecycle line' }: StripMapProps) {
  const flagsAt = (stage: StationStage) => stations[stage] ?? [];
  const sizes = stationOrder.map((stage) => 1 + (loading ? 0 : flagsAt(stage).length));
  const { itemProps, onKeyDown } = useRovingFocus(sizes, moveInStations);
  return (
    <div
      role="region"
      aria-label={label}
      className={styles.strip}
      onKeyDown={onKeyDown}
      data-strip-map=""
    >
      {stationOrder.map((stage, group) => {
        const side = sideLines[stage];
        return (
          <div
            key={stage}
            className={cx(
              styles.stop,
              side !== undefined && styles.side,
              stage === 'archived' && styles.terminus,
            )}
          >
            {side !== undefined && <p className={styles.sideLabel}>{side}</p>}
            <Station
              stage={stage}
              flags={flagsAt(stage)}
              loading={loading}
              layout="strip"
              zone={stationZones[stage]}
              roving={(item) => itemProps(group, item)}
            />
          </div>
        );
      })}
    </div>
  );
}

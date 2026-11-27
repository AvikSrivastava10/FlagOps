import type { CSSProperties } from 'react';
import { moveInStations, useRovingFocus } from '../lib/roving-focus';
import { mainLine, stationOrder, type BoardStations, type StationStage } from './board-layout';
import {
  LowerTrack,
  MainTrack,
  lowerStationColumns,
  lowerTrackHeight,
  mainTrackHeight,
  spurGridColumns,
} from './LineTrack';
import type { HeadingLevel } from './Heading';
import { Station } from './Station';
import { useArrivals } from './use-arrivals';
import { ZoneBand, type FlagsmithZone } from './ZoneBand';
import styles from './LineDiagram.module.css';

export type LineDiagramProps = {
  stations: BoardStations;
  /** Station plates show "Loading" flap text while the board loads. */
  loading?: boolean | undefined;
  /** The region's accessible name. */
  label?: string | undefined;
  /** The level of the station plates' headings. Defaults to 3. */
  headingLevel?: HeadingLevel | undefined;
};

/*
 * Grid: nine station columns with a gap column after each of the first eight (CSS grid lines 1
 * to 18), and rows for the zone labels, the main track, the stations, the lower zone labels, the
 * lower track and the lower stations.
 */
const rows = `var(--space-6) ${mainTrackHeight}px auto var(--space-6) ${lowerTrackHeight}px auto`;

const zones: readonly { zone: FlagsmithZone; gridColumn: string; gridRow: string }[] = [
  { zone: 'new', gridColumn: '1 / 2', gridRow: '1 / 4' },
  { zone: 'live', gridColumn: '3 / 10', gridRow: '1 / 4' },
  { zone: 'stale', gridColumn: '11 / 14', gridRow: '1 / 4' },
  { zone: 'to_remove', gridColumn: '15 / 16', gridRow: '1 / 4' },
  { zone: 'permanent', gridColumn: '1 / 4', gridRow: '4 / 7' },
  { zone: 'stale', gridColumn: '5 / 12', gridRow: '4 / 7' },
];

function placement(stage: StationStage): CSSProperties {
  if (stage === 'abandoned') return { gridColumn: lowerStationColumns.abandoned, gridRow: 6 };
  if (stage === 'permanent') return { gridColumn: lowerStationColumns.permanent, gridRow: 6 };
  return { gridColumn: mainLine.indexOf(stage) * 2 + 1, gridRow: 3 };
}

/**
 * The board's line (ui-design.md 5 and 6.3): zone bands, the decorative drawing of the line, the
 * Abandoned spur and the Permanent loop, and the stations, which carry all content and semantics.
 * The region scrolls horizontally when the stations do not fit (D-056). The board is one tab
 * stop: Left and Right move between stations, Up and Down between flags, Home and End go to the
 * first and last station. A flag that moves station after a sync slides into its new station.
 */
export function LineDiagram({
  stations,
  loading = false,
  label = 'Lifecycle line',
  headingLevel,
}: LineDiagramProps) {
  const flagsAt = (stage: StationStage) => stations[stage] ?? [];
  const sizes = stationOrder.map((stage) => 1 + (loading ? 0 : flagsAt(stage).length));
  const { itemProps, onKeyDown } = useRovingFocus(sizes, moveInStations);
  const arrived = useArrivals(stations);
  return (
    <div
      role="region"
      aria-label={label}
      className={styles.region}
      onKeyDown={onKeyDown}
      data-line-diagram=""
    >
      <div className={styles.grid} style={{ gridTemplateRows: rows }}>
        {zones.map(({ zone, gridColumn, gridRow }) => (
          <ZoneBand
            key={`${zone}-${gridColumn}`}
            zone={zone}
            className={styles.zone}
            style={{ gridColumn, gridRow }}
          />
        ))}
        <div className={styles.trackRow} style={{ gridColumn: '1 / -1', gridRow: 2 }}>
          <MainTrack />
        </div>
        {spurGridColumns.map((gridColumn) => (
          <div
            key={gridColumn}
            className={styles.spur}
            style={{ gridColumn, gridRow: '3 / 5' }}
            aria-hidden="true"
          />
        ))}
        <div className={styles.trackRow} style={{ gridColumn: '1 / -1', gridRow: 5 }}>
          <LowerTrack />
        </div>
        {stationOrder.map((stage, group) => (
          <div key={stage} className={styles.slot} style={placement(stage)}>
            <Station
              stage={stage}
              flags={flagsAt(stage)}
              loading={loading}
              roving={(item) => itemProps(group, item)}
              arrived={arrived}
              headingLevel={headingLevel}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

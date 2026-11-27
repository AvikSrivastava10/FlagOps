import { mainLine } from './board-layout';
import styles from './LineDiagram.module.css';

/*
 * The decorative drawing of the line (ui-design.md 3.3, line geometry): main line 8px, branches
 * 6px, station ticks 12 x 4px, interchange rings 18px with a 4px stroke, branches at 45 degrees
 * only. Station columns are exactly --station-min (200px) with --station-gap (16px) between them,
 * so the drawing uses the same pixel grid.
 */
const column = 200;
const gap = 16;
const pitch = column + gap;
const width = mainLine.length * column + (mainLine.length - 1) * gap;

/** Middle of station `index` on the main line. */
const stationX = (index: number) => index * pitch + column / 2;
/** Middle of the gap after station `index`, where the spur runs down and back up. */
const gutterX = (index: number) => index * pitch + column + gap / 2;

const spurOut = gutterX(mainLine.indexOf('development'));
const spurIn = gutterX(mainLine.indexOf('cleanup') - 1);
const interchanges = [mainLine.indexOf('development'), mainLine.indexOf('cleanup')];
const terminus = mainLine.indexOf('archived');

export const mainTrackHeight = 40;
export const lowerTrackHeight = 48;
const lineY = 16;
const spurY = 24;

/** The gap columns of the station grid the spur passes through: 1-based CSS grid columns. */
export const spurGridColumns = [
  mainLine.indexOf('development') * 2 + 2,
  (mainLine.indexOf('cleanup') - 1) * 2 + 2,
] as const;

/** Main line with its ticks, the two interchanges of the Abandoned spur, and the terminus bar. */
export function MainTrack() {
  const drop = mainTrackHeight - lineY;
  return (
    <svg
      className={styles.track}
      viewBox={`0 0 ${width} ${mainTrackHeight}`}
      width={width}
      height={mainTrackHeight}
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.main} d={`M0 ${lineY}H${stationX(terminus)}`} />
      <path
        className={styles.branch}
        d={`M${spurOut - drop} ${lineY}L${spurOut} ${mainTrackHeight}M${spurIn} ${mainTrackHeight}L${spurIn + drop} ${lineY}`}
      />
      {mainLine.map((stage, index) =>
        interchanges.includes(index) || index === terminus ? null : (
          <rect
            key={stage}
            className={styles.tick}
            x={stationX(index) - 2}
            y={lineY}
            width={4}
            height={16}
          />
        ),
      )}
      {interchanges.map((index) => (
        <circle key={index} className={styles.ring} cx={stationX(index)} cy={lineY} r={7} />
      ))}
      <rect
        className={styles.tick}
        x={stationX(terminus) - 4}
        y={lineY - 14}
        width={8}
        height={28}
      />
    </svg>
  );
}

/** The Abandoned spur below the line, and the Permanent loop, a closed loop with no terminus. */
export function LowerTrack() {
  const bend = spurY - 4;
  const abandoned = stationX(3);
  const permanent = stationX(0);
  return (
    <svg
      className={styles.track}
      viewBox={`0 0 ${width} ${lowerTrackHeight}`}
      width={width}
      height={lowerTrackHeight}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={styles.branch}
        d={`M${spurOut} 0V4L${spurOut + bend} ${spurY}H${spurIn - bend}L${spurIn} 4V0`}
      />
      <rect className={styles.tick} x={abandoned - 2} y={spurY} width={4} height={15} />
      <path className={styles.branch} d="M36 6H380L394 20L380 34H36L22 20Z" />
      <rect className={styles.tick} x={permanent - 2} y={34} width={4} height={12} />
    </svg>
  );
}

/** Grid columns of the lower deck's two stations, under the spur and inside the loop. */
export const lowerStationColumns = { abandoned: 3 * 2 + 1, permanent: 1 } as const;

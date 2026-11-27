import { useState } from 'react';
import { stationOrder, type BoardStations, type StationStage } from './board-layout';

const noArrivals: ReadonlySet<string> = new Set();

/** The station of each flag, by flag ID. */
function stationsByFlag(stations: BoardStations): Map<string, StationStage> {
  const byFlag = new Map<string, StationStage>();
  for (const stage of stationOrder) {
    for (const flag of stations[stage] ?? []) byFlag.set(flag.id, stage);
  }
  return byFlag;
}

/** The IDs of the flags that are at another station in `next` than in `previous`. */
function movedFlags(previous: BoardStations, next: BoardStations): ReadonlySet<string> {
  const before = stationsByFlag(previous);
  const moved = new Set<string>();
  for (const [id, stage] of stationsByFlag(next)) {
    const was = before.get(id);
    if (was !== undefined && was !== stage) moved.add(id);
  }
  return moved.size === 0 ? noArrivals : moved;
}

/**
 * The flags that have just moved to another station (ui-design.md 3.4: a flag moving to its new
 * station after a sync). A moved flag's entry mounts afresh in its new station's list, so only
 * the line, which holds every station, can tell a move from a mount. It remembers the stations of
 * the previous render, React's pattern for information from previous renders. A line that mounts
 * has no previous stations, so returning to the board animates nothing. `stations` should keep
 * its identity until the next sync; a new object counts as a new sync result.
 */
export function useArrivals(stations: BoardStations): ReadonlySet<string> {
  const [seen, setSeen] = useState(stations);
  const [arrived, setArrived] = useState(noArrivals);
  if (stations !== seen) {
    setSeen(stations);
    setArrived(movedFlags(seen, stations));
  }
  return arrived;
}

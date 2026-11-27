import type { StageId } from '@flagops/shared';
import type { FlagEntryData } from './FlagEntry';
import type { FlagsmithZone } from './ZoneBand';

/** A stage with a station on the line; `unknown` flags go to the "Not placed" panel instead. */
export type StationStage = Exclude<StageId, 'unknown'>;

/** The flags at each station. A missing station is empty. */
export type BoardStations = Readonly<Partial<Record<StationStage, readonly FlagEntryData[]>>>;

/** The main line, New to the Archived terminus (ui-design.md 6.3). */
export const mainLine = [
  'new',
  'development',
  'testing',
  'rolling_out',
  'released',
  'stale',
  'cleanup',
  'to_remove',
  'archived',
] as const satisfies readonly StationStage[];

/**
 * Reading and keyboard order of every station, on the diagram and on the strip map alike: the
 * main line, with Permanent and Abandoned as side sections after Released (ui-design.md 6.3,
 * narrow). Home and End go to New and to the Archived terminus.
 */
export const stationOrder = [
  'new',
  'development',
  'testing',
  'rolling_out',
  'released',
  'permanent',
  'abandoned',
  'stale',
  'cleanup',
  'to_remove',
  'archived',
] as const satisfies readonly StationStage[];

/**
 * The Flagsmith zone each station sits in (architecture.md 5.3). Cleanup PR open is drawn in
 * `stale`, where its flags stay while references remain; each flag's own zone is on its card.
 * Archived is outside the lifecycle.
 */
export const stationZones: Readonly<Record<StationStage, FlagsmithZone | null>> = {
  new: 'new',
  development: 'live',
  testing: 'live',
  rolling_out: 'live',
  released: 'live',
  stale: 'stale',
  cleanup: 'stale',
  to_remove: 'to_remove',
  archived: null,
  abandoned: 'stale',
  permanent: 'permanent',
};

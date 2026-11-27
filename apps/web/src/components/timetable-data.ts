import type { DriftCategory, FlagType } from '@flagops/shared';
import type { ReactNode } from 'react';
import type { ServeState } from './Lamp';

export type TimetableEnvironment = { id: string; name: string };

/** What one environment serves; `href` opens the flag in that environment. */
export type TimetableCell = { state: ServeState; value: string | null; href?: string | undefined };

/** The drift between two adjacent environments; `href` opens the Promote diff for the pair. */
export type TimetableDrift = {
  category: DriftCategory;
  href?: string | undefined;
};

export type TimetableRow = {
  id: string;
  flag: { name: string; type: FlagType | null; href: string };
  /** One per environment, in environment order. */
  cells: readonly TimetableCell[];
  /** One per adjacent pair: `drift[i]` sits between environments `i` and `i + 1`. */
  drift: readonly TimetableDrift[];
  /** The expanded row: the rule-by-rule comparison and the observation history (ui-design.md 6.5). */
  detail: ReactNode;
};

export type TimetableProps = {
  /** Names the table, such as "Drift across environments". */
  caption: string;
  environments: readonly TimetableEnvironment[];
  rows: readonly TimetableRow[];
  /** Shows "Loading" flap text in place of values (ui-design.md 6.11). */
  loading?: boolean | undefined;
  /** Shown when there are no rows, for example when filters match no flag. */
  emptyText?: string | undefined;
};

import { Fragment, useId, useState } from 'react';
import { moveInRows, useRovingFocus } from '../lib/roving-focus';
import { narrowQuery, useMediaQuery } from '../lib/use-media-query';
import { FlagName } from './FlagName';
import { FlapText } from './FlapText';
import { Icon } from './icons/Icon';
import { Lamp } from './Lamp';
import { Link } from './Link';
import { RouteBullet } from './RouteBullet';
import { TimetableBlocks } from './TimetableBlocks';
import { MarkerTarget, Target } from './TimetableTargets';
import type { TimetableProps } from './timetable-data';
import styles from './Timetable.module.css';

export type { TimetableProps } from './timetable-data';

/**
 * The drift matrix (ui-design.md 5 and 6.5): a table with a sticky first column of flags and a
 * sticky header row of environments, cells with a lamp and the value, and drift markers in the
 * gutters between columns. It is one tab stop with roving focus over the expand button, the flag
 * and every cell and marker. Narrow screens get one block per flag instead.
 */
export function Timetable(props: TimetableProps) {
  const narrow = useMediaQuery(narrowQuery);
  return narrow ? <TimetableBlocks {...props} /> : <TimetableGrid {...props} />;
}

function TimetableGrid({
  caption,
  environments,
  rows,
  loading = false,
  emptyText = 'No flags to compare.',
}: TimetableProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const columns = environments.length * 2;
  // Each row: the expand button, the flag, then the cells with a marker between each pair.
  const perRow = 1 + columns;
  const { itemProps, onKeyDown } = useRovingFocus(
    rows.map(() => perRow),
    moveInRows,
  );
  const toggle = (rowId: string) => {
    const next = new Set(expanded);
    if (!next.delete(rowId)) next.add(rowId);
    setExpanded(next);
  };

  // Without rows nothing inside can take focus, so the scrolling box itself is the tab stop.
  const scrollStop =
    loading || rows.length === 0
      ? { tabIndex: 0, role: 'region', 'aria-label': caption }
      : undefined;
  return (
    <div className={styles.scroller} data-timetable="" {...scrollStop}>
      <table className={styles.table} onKeyDown={onKeyDown} aria-busy={loading || undefined}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              Flag
            </th>
            {environments.map((environment, index) => {
              const next = environments[index + 1];
              return (
                <Fragment key={environment.id}>
                  <th scope="col" className={styles.environment}>
                    {environment.name}
                  </th>
                  {next !== undefined && (
                    <th scope="col" className={styles.gutterHead}>
                      <span className="visually-hidden">
                        Drift, {environment.name} to {next.name}
                      </span>
                    </th>
                  )}
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(loading || rows.length === 0) && (
            <tr>
              <td colSpan={columns} className={styles.status}>
                {loading ? <FlapText text="Loading" /> : emptyText}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row, group) => {
              const open = expanded.has(row.id);
              const detailId = `${id}-${row.id}`;
              return (
                <Fragment key={row.id}>
                  <tr className={styles.row}>
                    <th scope="row" className={styles.flagCell}>
                      <span className={styles.flagHead}>
                        <button
                          type="button"
                          className={styles.toggle}
                          aria-expanded={open}
                          aria-controls={detailId}
                          {...itemProps(group, 0)}
                          onClick={() => {
                            toggle(row.id);
                          }}
                        >
                          <Icon
                            name={open ? 'chevron-up' : 'chevron-down'}
                            label={`${open ? 'Hide' : 'Show'} the comparison for ${row.flag.name}`}
                          />
                        </button>
                        <RouteBullet type={row.flag.type} />
                        <Link
                          href={row.flag.href}
                          className={styles.flagLink}
                          {...itemProps(group, 1)}
                        >
                          <FlagName name={row.flag.name} />
                        </Link>
                      </span>
                    </th>
                    {environments.map((environment, index) => {
                      const cell = row.cells[index];
                      const drift = row.drift[index];
                      const next = environments[index + 1];
                      return (
                        <Fragment key={environment.id}>
                          <td className={styles.cell}>
                            {cell !== undefined && (
                              <Target href={cell.href} roving={itemProps(group, 2 + index * 2)}>
                                <Lamp state={cell.state} value={cell.value} />
                              </Target>
                            )}
                          </td>
                          {next !== undefined && (
                            <td className={styles.gutter}>
                              {drift !== undefined && (
                                <MarkerTarget
                                  drift={drift}
                                  pair={`${environment.name} to ${next.name}`}
                                  roving={itemProps(group, 3 + index * 2)}
                                />
                              )}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                  </tr>
                  <tr id={detailId} className={styles.detailRow} hidden={!open}>
                    <td colSpan={columns} className={styles.detail}>
                      <div className={styles.detailBody}>{row.detail}</div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

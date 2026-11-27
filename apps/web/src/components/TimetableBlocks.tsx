import { Fragment, useId, useState } from 'react';
import { driftText, servesMoreLaterTip } from './DriftMarker';
import { FlagName } from './FlagName';
import { FlapText } from './FlapText';
import { Lamp } from './Lamp';
import { Link } from './Link';
import { RouteBullet } from './RouteBullet';
import type { TimetableProps, TimetableRow } from './timetable-data';
import styles from './TimetableBlocks.module.css';

/**
 * The drift matrix on narrow screens (ui-design.md 6.5): one block per flag with the environments
 * stacked, and each drift marker as a text row between two environments.
 */
export function TimetableBlocks({
  caption,
  environments,
  rows,
  loading = false,
  emptyText = 'No flags to compare.',
}: TimetableProps) {
  const captionId = useId();
  return (
    <section className={styles.blocks} aria-labelledby={captionId} data-timetable="">
      <h3 id={captionId} className={styles.caption}>
        {caption}
      </h3>
      {loading ? (
        <p className={styles.status}>
          <FlapText text="Loading" />
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.status}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <Block key={row.id} row={row} environments={environments} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Block({
  row,
  environments,
}: { row: TimetableRow } & Pick<TimetableProps, 'environments'>) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.block}>
      <p className={styles.flag}>
        <RouteBullet type={row.flag.type} />
        <Link href={row.flag.href} className={styles.flagLink}>
          <FlagName name={row.flag.name} />
        </Link>
      </p>
      <dl className={styles.environments}>
        {environments.map((environment, index) => {
          const cell = row.cells[index];
          const drift = row.drift[index];
          const next = environments[index + 1];
          return (
            <Fragment key={environment.id}>
              <div className={styles.environment}>
                <dt>{environment.name}</dt>
                <dd>
                  {cell !== undefined &&
                    (cell.href === undefined ? (
                      <Lamp state={cell.state} value={cell.value} />
                    ) : (
                      <Link href={cell.href} className={styles.cellLink}>
                        <Lamp state={cell.state} value={cell.value} />
                      </Link>
                    ))}
                </dd>
              </div>
              {next !== undefined && drift !== undefined && drift.category !== 'aligned' && (
                <div className={styles.drift}>
                  <dt className="visually-hidden">
                    Drift, {environment.name} to {next.name}
                  </dt>
                  <dd>
                    {drift.href === undefined ? (
                      driftText(drift.category)
                    ) : (
                      <Link href={drift.href}>{driftText(drift.category)}</Link>
                    )}
                    {/* Touch screens have no hover, so the tooltip's text is shown here. */}
                    {drift.category === 'later_serves_more' && (
                      <span className={styles.tip}>{servesMoreLaterTip}</span>
                    )}
                  </dd>
                </div>
              )}
            </Fragment>
          );
        })}
      </dl>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Hide the comparison' : 'Show the comparison'}
        {/* Every block has this button, so its name says which flag it is for. */}
        <span className="visually-hidden"> for {row.flag.name}</span>
      </button>
      <div id={detailId} className={styles.detail} hidden={!open}>
        {row.detail}
      </div>
    </li>
  );
}

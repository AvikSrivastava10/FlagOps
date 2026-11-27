import { cx } from '../lib/class-names';
import { narrowQuery, useMediaQuery } from '../lib/use-media-query';
import type { ConfigDiffProps, ConfigField, ConfigValue } from './diff-data';
import styles from './ConfigDiff.module.css';

function Value({ value }: { value: ConfigValue }) {
  if (value === null) return <span className={styles.unset}>Not set</span>;
  return value.mono === true ? (
    <code className={styles.mono}>{value.text}</code>
  ) : (
    <span>{value.text}</span>
  );
}

function Mark({ field }: { field: ConfigField }) {
  return (
    <>
      {field.changed && <span className={styles.changed}>changed</span>}
      {field.note !== undefined && <span className={styles.note}>{field.note}</span>}
    </>
  );
}

/**
 * The side-by-side configuration diff (ui-design.md 5): fields in rows, source and target in
 * columns, changed fields marked with a bar and the text "changed". On narrow screens it becomes
 * a field list with both values under each field (ui-design.md 6.6).
 */
export function ConfigDiff({
  caption,
  sourceName,
  targetName,
  fields,
}: Omit<ConfigDiffProps, 'mode'>) {
  const narrow = useMediaQuery(narrowQuery);
  if (narrow) {
    return (
      <section className={styles.list} aria-label={caption}>
        <p className={styles.caption}>{caption}</p>
        <dl className={styles.fields}>
          {fields.map((field) => (
            <div
              key={field.id}
              className={cx(styles.item, field.changed && styles.changedRow)}
              data-changed={field.changed || undefined}
            >
              <dt className={styles.label}>
                {field.label} <Mark field={field} />
              </dt>
              <dd className={styles.side}>
                <span className={styles.sideName}>{sourceName}</span>
                <Value value={field.source} />
              </dd>
              <dd className={styles.side}>
                <span className={styles.sideName}>{targetName}</span>
                <Value value={field.target} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">{sourceName}</th>
          <th scope="col">{targetName}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr
            key={field.id}
            className={cx(field.changed && styles.changedRow)}
            data-changed={field.changed || undefined}
          >
            <th scope="row" className={styles.label}>
              {field.label} <Mark field={field} />
            </th>
            <td>
              <Value value={field.source} />
            </td>
            <td>
              <Value value={field.target} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

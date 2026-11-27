import { useId } from 'react';
import { FlagName } from './FlagName';
import { Icon } from './icons/Icon';
import { Link } from './Link';
import styles from './SidePanel.module.css';

export type SidePanelItem = {
  id: string;
  /** A flag name, or a name found in code that matches no flag. */
  name: string;
  /** Why it is here: the reason a flag is not placed, or where a name is used and the suggestion. */
  detail: string;
  /** The flag page, for names that belong to a flag. */
  href?: string | undefined;
};

export type SidePanelProps = {
  /** "Unknown names" or "Not placed". */
  title: string;
  items: readonly SidePanelItem[];
};

/**
 * A board side panel (ui-design.md 5 and 6.3): a "no such station" sign plate, then a list. An
 * empty panel is not shown.
 */
export function SidePanel({ title, items }: SidePanelProps) {
  const titleId = useId();
  if (items.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.plate}>
        <Icon name="zombie-reference" className={styles.glyph} />
        <p className={styles.caption}>No such station</p>
        <h3 id={titleId} className={styles.title}>
          {title}
          <span className={styles.count}>
            {items.length}
            <span className="visually-hidden">{items.length === 1 ? ' entry' : ' entries'}</span>
          </span>
        </h3>
      </header>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            {item.href === undefined ? (
              <FlagName name={item.name} className={styles.name} />
            ) : (
              <Link href={item.href} className={styles.link}>
                <FlagName name={item.name} className={styles.name} />
              </Link>
            )}
            <p className={styles.detail}>{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

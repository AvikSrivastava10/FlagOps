import type { ReactNode } from 'react';
import { cx } from '../lib/class-names';
import styles from './gallery.module.css';

/** One component family of the gallery; the Playwright spec screenshots each section. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={styles.section}
      aria-labelledby={`${id}-title`}
      data-gallery-section={id}
    >
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      <p className={styles.description}>{description}</p>
      <div className={styles.states}>{children}</div>
    </section>
  );
}

/** One state of a component, captioned with the state's name. */
export function State({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Spans the full width of the section, for the line diagram and tables. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className={cx(styles.state, wide && styles.wide)} data-gallery-state={label}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <div className={styles.frame}>{children}</div>
    </figure>
  );
}

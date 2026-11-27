import { Board } from './sections/Board';
import { Changes } from './sections/Changes';
import { Controls } from './sections/Controls';
import { Foundations } from './sections/Foundations';
import { Indicators } from './sections/Indicators';
import { Signage } from './sections/Signage';
import styles from './gallery.module.css';

const contents = [
  ['tokens', 'Colour'],
  ['type', 'Type'],
  ['icons', 'Icons'],
  ['signage-bar', 'Signage bar'],
  ['banner', 'Banner'],
  ['notice', 'Notice'],
  ['route-bullet', 'Route bullet'],
  ['lamp', 'Lamp'],
  ['flap-text', 'Flap text'],
  ['zone-band', 'Zone band'],
  ['history', 'History strip'],
  ['evidence-line', 'Evidence line'],
  ['flag-entry', 'Flag entry'],
  ['station', 'Station'],
  ['line-diagram', 'Line diagram'],
  ['strip-map', 'Strip map'],
  ['side-panel', 'Side panels'],
  ['timetable', 'Timetable'],
  ['diff-config', 'Configuration diff'],
  ['diff-code', 'Code diff'],
  ['impact-summary', 'Impact summary'],
  ['buttons', 'Buttons'],
  ['inputs', 'Inputs'],
  ['confirm-gate', 'Confirm gate'],
] as const;

/**
 * Every component of ui-design.md 5 in every state, from fixture data. A development-only entry
 * (gallery.html): the production build has index.html as its only input, so none of this ships.
 */
export function Gallery() {
  return (
    <main id="gallery-main" className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.title}>FlagOps components</h1>
        <p className={styles.lead}>
          The transit-line design system: tokens, type, icons and every presentational component, in
          each of its states.
        </p>
        <nav aria-label="Gallery sections">
          <ul className={styles.toc}>
            {contents.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <Foundations />
      <Signage />
      <Indicators />
      <Board />
      <Changes />
      <Controls />
    </main>
  );
}

import { Icon } from '../../components/icons/Icon';
import { glyphs, type IconName } from '../../components/icons/glyphs';
import { Section, State } from '../Specimen';
import styles from '../gallery.module.css';

const colours = [
  'paper',
  'paper-raised',
  'paper-sunken',
  'ink',
  'ink-2',
  'ink-3',
  'rule-soft',
  'signage',
  'signage-ink-2',
  'line',
  'type-release',
  'type-experiment',
  'type-ops',
  'type-permission',
  'zone-new',
  'zone-live',
  'zone-stale',
  'zone-to-remove',
  'zone-permanent',
  'lamp-on',
  'lamp-partial',
  'amber-ink',
  'notice',
  'danger',
  'diff-add',
  'diff-del',
  'flap-tile',
];

const scale = ['display', 'h1', 'h2', 'h3', 'lead', 'body', 'small', 'meta'] as const;

const faces = [
  { token: 'sign', sample: 'ROLLING OUT · READY FOR REMOVAL', sign: true },
  {
    token: 'ui',
    sample: 'Production serves ON to everyone, so every check becomes true.',
    sign: false,
  },
  { token: 'mono', sample: 'new_checkout · "control" · 5369ece', sign: false },
] as const;

/** Tokens, type and the icon set (ui-design.md 3 and 4). */
export function Foundations() {
  return (
    <>
      <Section
        id="tokens"
        title="Colour"
        description="Every colour token of ui-design.md 3.1. Colour is reserved for meaning; chrome stays ink and paper."
      >
        <State label="Palette" wide>
          {colours.map((name) => (
            <span key={name} className={styles.swatch}>
              <span className={styles.chip} style={{ background: `var(--color-${name})` }} />
              {name}
            </span>
          ))}
        </State>
      </Section>
      <Section
        id="type"
        title="Type"
        description="One sign face (Barlow Condensed), one text face (Barlow) and one mono face (IBM Plex Mono), all self-hosted."
      >
        <State label="Faces" wide>
          <div className={styles.stack}>
            {faces.map((face) => (
              <p
                key={face.token}
                style={{
                  font: `var(--weight-semibold) var(--text-h3) var(--font-${face.token})`,
                  letterSpacing: face.sign ? 'var(--sign-tracking)' : undefined,
                }}
              >
                {face.sample}
              </p>
            ))}
          </div>
        </State>
        <State label="Scale" wide>
          <div className={styles.stack}>
            {scale.map((step) => (
              <p
                key={step}
                style={{ font: `var(--weight-regular) var(--text-${step}) var(--font-ui)` }}
              >
                {step}: flags leaving the codebase
              </p>
            ))}
          </div>
        </State>
      </Section>
      <Section
        id="icons"
        title="Icons"
        description="The custom set on a 20px grid with 2px strokes and square caps. Each has a text label or an aria-label."
      >
        <State label="All glyphs" wide>
          {(Object.keys(glyphs) as IconName[]).map((name) => (
            <span key={name} className={styles.swatch}>
              <Icon name={name} />
              {name}
            </span>
          ))}
        </State>
      </Section>
    </>
  );
}

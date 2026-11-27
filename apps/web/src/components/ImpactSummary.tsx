import { useId } from 'react';
import { FlagName } from './FlagName';
import { Icon, type IconName } from './icons/Icon';
import { Link } from './Link';
import styles from './ImpactSummary.module.css';

export const impactKinds = [
  'offToOn',
  'onToOff',
  'valueChanged',
  'unchanged',
  'valueEstimated',
] as const;

export type ImpactKind = (typeof impactKinds)[number];

export type ImpactBlock = {
  flagName: string;
  /** The promoted flag comes first, then the flags that depend on it. */
  role: 'promoted' | 'dependent';
  counts: Readonly<Record<ImpactKind, number>>;
  /** Filter links for the identity table, one per number. */
  hrefs: Readonly<Record<ImpactKind, string>>;
  /** The divergence lint's cause when the preview for this flag is approximate. */
  approximate?: string | null | undefined;
};

export type ImpactSummaryProps = {
  blocks: readonly ImpactBlock[];
};

const kinds: Readonly<Record<ImpactKind, { label: string; glyphs: readonly IconName[] }>> = {
  offToOn: { label: 'OFF to ON', glyphs: ['lamp-off', 'arrow-forward', 'lamp-on'] },
  onToOff: { label: 'ON to OFF', glyphs: ['lamp-on', 'arrow-forward', 'lamp-off'] },
  valueChanged: { label: 'Value changed', glyphs: [] },
  unchanged: { label: 'Unchanged', glyphs: [] },
  valueEstimated: { label: 'Value estimated', glyphs: [] },
};

const numberFormat = new Intl.NumberFormat('en');

/**
 * Who changes (ui-design.md 5, 6.6): one block per evaluated flag, with large tabular numbers for
 * OFF to ON, ON to OFF, value changed, unchanged and value estimated. Each number filters the
 * identity table, and an "approximate" tag names the cause when the lint marks the flag.
 */
export function ImpactSummary({ blocks }: ImpactSummaryProps) {
  if (blocks.length === 0) return <p className={styles.empty}>No flags evaluated.</p>;
  return (
    <div className={styles.summary}>
      {blocks.map((block) => (
        <Block key={block.flagName} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: ImpactBlock }) {
  const titleId = useId();
  const approximate = block.approximate ?? null;
  return (
    <section className={styles.block} aria-labelledby={titleId} data-role={block.role}>
      <header className={styles.header}>
        <h3 id={titleId} className={styles.title}>
          <FlagName name={block.flagName} />
          <span className={styles.role}>
            {block.role === 'promoted' ? 'Promoted flag' : 'Depends on the promoted flag'}
          </span>
        </h3>
        {approximate !== null && (
          <p className={styles.approximate}>
            <span className={styles.tag}>Approximate</span> {approximate}
          </p>
        )}
      </header>
      <dl className={styles.numbers}>
        {impactKinds.map((kind) => (
          <div key={kind} className={styles.number} data-kind={kind}>
            <dt className={styles.label}>
              {kinds[kind].glyphs.map((glyph, index) => (
                <Icon key={index} name={glyph} className={styles.glyph} />
              ))}
              {kinds[kind].label}
            </dt>
            <dd className={styles.value}>
              <Link href={block.hrefs[kind]} className={styles.count}>
                {numberFormat.format(block.counts[kind])}
                <span className="visually-hidden">
                  {' '}
                  identities: {kinds[kind].label}. Show them in the identity table
                </span>
              </Link>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

import { permanentFlagTypes, type FlagType } from '@flagops/shared';
import { cx } from '../lib/class-names';
import styles from './RouteBullet.module.css';

export type RouteBulletProps = {
  /** The flag's type from its exit plan; null when it has none (unclassified). */
  type: FlagType | null;
  /** 20px in lists, 32px in headers (ui-design.md 5). */
  size?: 'list' | 'header';
  /** Set while the flag is hovered or focused (ui-design.md 6.3). */
  highlighted?: boolean;
};

const typeNames: Readonly<Record<FlagType, string>> = {
  release: 'Release',
  experiment: 'Experiment',
  ops: 'Ops',
  permission: 'Permission',
};

const letters: Readonly<Record<FlagType, string>> = {
  release: 'R',
  experiment: 'E',
  ops: 'O',
  permission: 'P',
};

const pixels = { list: 20, header: 32 } as const;

/** Half of the 1.5px ink outline, so the outline stays inside the bullet's box. */
const inset = 0.75;

export type BulletShape = 'circle' | 'diamond' | 'unclassified';

export function bulletShape(type: FlagType | null): BulletShape {
  if (type === null) return 'unclassified';
  return permanentFlagTypes.includes(type) ? 'diamond' : 'circle';
}

/** The accessible name of a type, also used by entries that name the type in their label. */
export function flagTypeLabel(type: FlagType | null): string {
  return type === null ? 'Unclassified flag' : `${typeNames[type]} flag`;
}

/**
 * The type bullet (ui-design.md 3.1). Shape and letter carry the type as well as the colour:
 * circles for temporary types, diamonds for permanent ones, a dashed ring with "?" for none.
 */
export function RouteBullet({ type, size = 'list', highlighted = false }: RouteBulletProps) {
  const box = pixels[size];
  const middle = box / 2;
  const shape = bulletShape(type);
  return (
    <span
      className={cx(styles.bullet, styles[size], highlighted && styles.highlighted)}
      role="img"
      aria-label={flagTypeLabel(type)}
      data-shape={shape}
      data-type={type ?? 'unclassified'}
    >
      <svg viewBox={`0 0 ${box} ${box}`} aria-hidden="true" focusable="false">
        {shape === 'diamond' ? (
          <path
            className={cx(styles.shape, type !== null && styles[type])}
            d={`M${middle} ${inset}L${box - inset} ${middle}L${middle} ${box - inset}L${inset} ${middle}Z`}
          />
        ) : (
          <circle
            className={cx(styles.shape, type === null ? styles.unclassified : styles[type])}
            cx={middle}
            cy={middle}
            r={middle - inset}
          />
        )}
        <text
          className={cx(styles.letter, shape === 'diamond' && styles.diamondLetter)}
          x={middle}
          y={middle}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {type === null ? '?' : letters[type]}
        </text>
      </svg>
    </span>
  );
}

import type { DriftCategory } from '@flagops/shared';
import { Icon, type IconName } from './icons/Icon';
import styles from './DriftMarker.module.css';

type MarkerText = {
  /** Shown in the gutter; empty for aligned. */
  visible: string;
  /** Read after the visible text, so the marker is complete without its glyph. */
  hidden: string;
  glyph?: IconName;
};

/** The drift markers between two environments (ui-design.md 6.5). */
const markers: Readonly<Record<DriftCategory, MarkerText>> = {
  aligned: { visible: '', hidden: 'aligned' },
  ahead: { visible: 'ahead', hidden: ' in earlier environment', glyph: 'arrow-back' },
  later_serves_more: { visible: 'serves more later', hidden: '', glyph: 'arrow-forward' },
  value_drift: { visible: '≠ value', hidden: '' },
  override_drift: { visible: '≠ override', hidden: '' },
  one_sided_override: { visible: 'one-sided', hidden: ' override' },
  dependency_drift: { visible: '≠ dependency', hidden: '' },
};

/** The tooltip on "serves more later" (ui-design.md 6.5, architecture.md 5.5). */
export const servesMoreLaterTip =
  'The later environment serves the flag to more identities. Inverted drift, the health condition, is the production case: Production serves the flag while an earlier environment serves it to nobody.';

/** The marker's whole text, for labels and the narrow layout's text rows. */
export function driftText(category: DriftCategory): string {
  const marker = markers[category];
  return `${marker.visible}${marker.hidden}`;
}

/** A drift marker: an arrow where it has one, and always text (ui-design.md 8). */
export function DriftMarker({ category }: { category: DriftCategory }) {
  const marker = markers[category];
  return (
    <span className={styles.marker} data-drift={category}>
      {marker.glyph !== undefined && <Icon name={marker.glyph} className={styles.glyph} />}
      {marker.visible !== '' && <span>{marker.visible}</span>}
      {marker.hidden !== '' && <span className="visually-hidden">{marker.hidden}</span>}
    </span>
  );
}

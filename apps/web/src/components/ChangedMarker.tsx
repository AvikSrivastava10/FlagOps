import styles from './ChangedMarker.module.css';

/**
 * The static marker a changed item shows under reduced motion, in place of its animation
 * (ui-design.md 3.4). The item decides when to show it, through useChangeMarker.
 */
export function ChangedMarker() {
  return (
    <span className={styles.marker} data-changed-marker="">
      Changed
    </span>
  );
}

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../lib/anchored-position';
import { EvidenceLine, type EvidenceSegment } from './EvidenceLine';
import { FlagName } from './FlagName';
import { HistoryStrip, type HistoryEntry } from './HistoryStrip';
import { ZoneTag, type FlagsmithZone } from './ZoneBand';
import styles from './EvidenceCard.module.css';

/** What the card shows about one flag (ui-design.md 5). */
export type EvidenceCardData = {
  evidence: readonly EvidenceSegment[];
  /** The last stages, oldest first. */
  history: readonly HistoryEntry[];
  /** Derived owners, such as "@AvikSrivastava10". */
  owners: readonly string[];
  /** The flag's Flagsmith zone; null for an archived flag, which is outside the lifecycle. */
  zone: FlagsmithZone | null;
};

export type EvidenceCardProps = EvidenceCardData & {
  /** The id the entry names in `aria-describedby`. */
  id: string;
  flagName: string;
  /** The entry the card belongs to. */
  anchor: HTMLElement | null;
  open: boolean;
  /** Hover handlers from the entry's useHoverFocus, so the pointer can rest on the card. */
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

/**
 * Popover anchored to a FlagEntry (ui-design.md 5): the full evidence line, a word-sized history
 * strip, the owners and the Flagsmith zone, on paper-raised with a 2px ink border. It renders in a
 * portal with fixed coordinates, so the board's scrolling region never clips it, and it sits
 * below or above the entry, never over it. While closed it stays in the document, hidden, so the
 * entry's description is complete the moment the entry gets focus (ui-design.md 8).
 */
export function EvidenceCard({
  id,
  flagName,
  anchor,
  open,
  evidence,
  history,
  owners,
  zone,
  onMouseEnter,
  onMouseLeave,
}: EvidenceCardProps) {
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const position = useAnchoredPosition(anchor, card, open);
  return createPortal(
    <div
      role="tooltip"
      id={id}
      ref={setCard}
      className={styles.card}
      hidden={!open}
      style={open ? position : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-evidence-card=""
    >
      <p className={styles.name}>
        <FlagName name={flagName} />
      </p>
      <EvidenceLine segments={evidence} interactive={false} className={styles.evidence} />
      <dl className={styles.facts}>
        <dt>History</dt>
        <dd>
          <HistoryStrip entries={history} />
        </dd>
        <dt>Owners</dt>
        <dd>{owners.length > 0 ? owners.join(', ') : 'No owners found in CODEOWNERS'}</dd>
        <dt>Zone</dt>
        <dd>{zone === null ? 'Outside the Flagsmith lifecycle' : <ZoneTag zone={zone} />}</dd>
      </dl>
    </div>,
    document.body,
  );
}

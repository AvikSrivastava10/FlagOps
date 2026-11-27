import { flagTypes } from '@flagops/shared';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { ChangedMarker } from '../../components/ChangedMarker';
import { EvidenceLine } from '../../components/EvidenceLine';
import { FlapText } from '../../components/FlapText';
import { HistoryStrip } from '../../components/HistoryStrip';
import { Lamp } from '../../components/Lamp';
import { RouteBullet } from '../../components/RouteBullet';
import { Tooltip } from '../../components/Tooltip';
import { ZoneBand, ZoneTag, flagsmithZones } from '../../components/ZoneBand';
import { darkMode, newCheckout } from '../fixtures/board';
import { Section, State } from '../Specimen';
import styles from '../gallery.module.css';

const statuses = ['Ready', 'Boarding', 'Delayed', 'Held', 'Departed'];

function TipTrigger({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip text={tip}>
      {(trigger) => (
        <a href="#scan-demo-shop" {...trigger} data-gallery-tip={label}>
          {label}
        </a>
      )}
    </Tooltip>
  );
}

/** Bullets, lamps, flaps, zones, history strips, evidence lines and tooltips. */
export function Indicators() {
  const [change, setChange] = useState<{ key: number | null; status: number }>({
    key: null,
    status: 0,
  });
  const status = statuses[change.status % statuses.length] ?? 'Ready';
  return (
    <>
      <Section
        id="route-bullet"
        title="Route bullet"
        description="Circles for temporary types, diamonds for permanent ones, a dashed ring for none; a letter and a 1.5px ink outline on each."
      >
        <State label="List, 20px">
          {flagTypes.map((type) => (
            <RouteBullet key={type} type={type} />
          ))}
          <RouteBullet type={null} />
        </State>
        <State label="Header, 32px">
          {flagTypes.map((type) => (
            <RouteBullet key={type} type={type} size="header" />
          ))}
          <RouteBullet type={null} size="header" />
        </State>
        <State label="Highlighted">
          <RouteBullet type="release" highlighted />
          <RouteBullet type="ops" highlighted />
        </State>
      </Section>
      <Section
        id="lamp"
        title="Lamp"
        description="The serve state: the lamp's shape and the label carry it, colour reinforces it."
      >
        <State label="With values">
          <div className={styles.stack}>
            <Lamp state="on" value="true" />
            <Lamp state="partial" value='"v2" 50% · "control" 50%' />
            <Lamp state="off" value='"control"' />
          </div>
        </State>
        <State label="Without a value">
          <div className={styles.stack}>
            <Lamp state="on" />
            <Lamp state="partial" />
            <Lamp state="off" />
          </div>
        </State>
      </Section>
      <Section
        id="flap-text"
        title="Flap text"
        description="Split-flap labels for stages and Departures. A change flips at most 8 tiles within 400ms; reduced motion shows a static marker."
      >
        <State label="Sizes">
          <div className={styles.stack}>
            <FlapText text="Rolling out" size="large" />
            <FlapText text="Ready for removal" />
            <FlapText text="Boarding" size="small" />
          </div>
        </State>
        <State label="Loading">
          <FlapText text="Loading" />
        </State>
        <State label="Fixed width, changes on demand">
          <div className={styles.stack} data-gallery-flap="">
            <FlapText text={status} cells={9} changeKey={change.key} />
            <Button
              variant="secondary"
              onClick={() => {
                setChange({ key: (change.key ?? 0) + 1, status: change.status + 1 });
              }}
            >
              Change status
            </Button>
          </div>
        </State>
      </Section>
      <Section
        id="zone-band"
        title="Zone band"
        description="Flagsmith's lifecycle stages as fare zones behind the stations."
      >
        <State label="Bands" wide>
          {flagsmithZones.map((zone) => (
            <ZoneBand key={zone} zone={zone} />
          ))}
        </State>
        <State label="Tags">
          {flagsmithZones.map((zone) => (
            <ZoneTag key={zone} zone={zone} />
          ))}
        </State>
      </Section>
      <Section
        id="history"
        title="History strip and changed marker"
        description="A word-sized line of the stages a flag has been at; the marker that replaces motion."
      >
        <State label="Word-sized">
          <HistoryStrip entries={darkMode.history} />
        </State>
        <State label="With dates">
          <HistoryStrip entries={newCheckout.history} variant="dated" />
        </State>
        <State label="No history yet">
          <HistoryStrip entries={[]} />
        </State>
        <State label="Changed marker">
          <ChangedMarker />
        </State>
      </Section>
      <Section
        id="evidence-line"
        title="Evidence line"
        description="Segments separated by a middle dot; each number links to its source, named on hover and focus."
      >
        <State label="Interactive" wide>
          <EvidenceLine segments={newCheckout.evidence} />
        </State>
        <State label="Inside the evidence card: plain text" wide>
          <EvidenceLine segments={newCheckout.evidence} interactive={false} />
        </State>
        <State label="Tooltip on a right-hand trigger" wide>
          <div className={styles.rightEdge}>
            <TipTrigger
              label="2 references"
              tip="Latest scan of AvikSrivastava10/flagops-demo-shop at 09:14, commit 5369ece."
            />
          </div>
        </State>
        <State label="Tooltip inside a scrolling region" wide>
          <div
            className={styles.scrollBox}
            role="region"
            aria-label="Scrolling example"
            tabIndex={0}
          >
            <div className={styles.scrollTrack}>
              <TipTrigger label="3 of 3 environments" tip="Environment rows on the flag page." />
              <TipTrigger label="6 references" tip="Latest scans of 2 repositories." />
            </div>
          </div>
        </State>
      </Section>
    </>
  );
}

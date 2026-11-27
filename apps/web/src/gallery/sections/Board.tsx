import { useState } from 'react';
import { Button } from '../../components/Button';
import { FlagEntry } from '../../components/FlagEntry';
import { LineDiagram } from '../../components/LineDiagram';
import { SidePanel } from '../../components/SidePanel';
import { Station } from '../../components/Station';
import { StripMap } from '../../components/StripMap';
import {
  boardStations,
  crowdedStation,
  darkMode,
  newCheckout,
  notPlaced,
  unknownNames,
} from '../fixtures/board';
import { Section, State } from '../Specimen';
import styles from '../gallery.module.css';

/** Flag entries, stations, the line diagram, the strip map and the side panels (ui-design.md 6.3). */
export function Board() {
  const [arrival, setArrival] = useState<number | null>(null);
  return (
    <>
      <Section
        id="flag-entry"
        title="Flag entry and evidence card"
        description="Bullet, wrapping mono name and notice glyphs. Hover or focus opens the evidence card, which never covers the entry."
      >
        <State label="Entries">
          <ul className={styles.stack} data-gallery-entries="">
            <FlagEntry {...newCheckout} />
            <FlagEntry {...darkMode} />
            {boardStations.archived?.map((flag) => (
              <FlagEntry key={flag.id} {...flag} />
            ))}
          </ul>
        </State>
        <State label="Arrival after a sync">
          <div className={styles.stack}>
            <ul>
              <FlagEntry {...darkMode} changeKey={arrival} />
            </ul>
            <Button
              variant="secondary"
              onClick={() => {
                setArrival((arrival ?? 0) + 1);
              }}
            >
              Simulate a sync
            </Button>
          </div>
        </State>
      </Section>
      <Section
        id="station"
        title="Station"
        description="Name plate in sign type with a 2px rule and the count, then the flags. Long lists scroll under the plate."
      >
        <State label="With flags">
          <Station stage="permanent" flags={boardStations.permanent ?? []} />
        </State>
        <State label="Empty">
          <Station stage="cleanup" flags={[]} />
        </State>
        <State label="Loading">
          <Station stage="testing" flags={[]} loading />
        </State>
        <State label="Long list">
          <Station stage="rolling_out" flags={crowdedStation} />
        </State>
      </Section>
      <Section
        id="line-diagram"
        title="Line diagram"
        description="Zone bands, the line with its Abandoned spur and Permanent loop, and every station. The region scrolls horizontally; the page does not."
      >
        <State label="Demo project" wide>
          <LineDiagram stations={boardStations} />
        </State>
        <State label="Loading" wide>
          <LineDiagram stations={{}} loading label="Lifecycle line, loading" />
        </State>
      </Section>
      <Section
        id="strip-map"
        title="Strip map"
        description="The line for narrow screens: stations top to bottom, Permanent and Abandoned as side sections after Released."
      >
        <State label="Demo project">
          <div className={styles.narrowFrame}>
            <StripMap stations={boardStations} label="Lifecycle line, strip map" />
          </div>
        </State>
      </Section>
      <Section
        id="side-panel"
        title="Side panels"
        description="Unknown names and Not placed, in the no-such-station style. An empty panel renders nothing."
      >
        <State label="Unknown names">
          <SidePanel title="Unknown names" items={unknownNames} />
        </State>
        <State label="Not placed">
          <SidePanel title="Not placed" items={notPlaced} />
        </State>
        <State label="Empty: not shown">
          <SidePanel title="Not placed" items={[]} />
        </State>
      </Section>
    </>
  );
}

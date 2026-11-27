import { DiffView } from '../../components/DiffView';
import { ImpactSummary } from '../../components/ImpactSummary';
import { Timetable } from '../../components/Timetable';
import { codeFiles, configFields, impactBlocks } from '../fixtures/diff';
import { driftEnvironments, driftRows } from '../fixtures/drift';
import { Section, State } from '../Specimen';

/** The timetable, both diffs and the impact summary (ui-design.md 6.5, 6.6, 6.8). */
export function Changes() {
  return (
    <>
      <Section
        id="timetable"
        title="Timetable"
        description="The drift matrix: sticky flags and environments, lamps with values, and a marker with text in every gutter."
      >
        <State label="Every drift category" wide>
          <Timetable
            caption="Drift across environments"
            environments={driftEnvironments}
            rows={driftRows}
          />
        </State>
        <State label="Loading">
          <Timetable caption="Drift, loading" environments={driftEnvironments} rows={[]} loading />
        </State>
        <State label="No matching flags">
          <Timetable
            caption="Drift, filtered"
            environments={driftEnvironments}
            rows={[]}
            emptyText="No flags match these filters."
          />
        </State>
      </Section>
      <Section
        id="diff-config"
        title="Configuration diff"
        description="Fields in rows, source and target in columns; changed fields carry a bar and the text changed."
      >
        <State label="dark_mode, Staging to Production" wide>
          <DiffView
            mode="config"
            caption="dark_mode, Staging to Production"
            sourceName="Staging"
            targetName="Production"
            fields={configFields}
          />
        </State>
      </Section>
      <Section
        id="diff-code"
        title="Code diff"
        description="Unified, mono, with line numbers and plus and minus signs. A deleted file shows its removed lines (BN-2)."
      >
        <State label="new_checkout retirement" wide>
          <DiffView mode="code" files={codeFiles} />
        </State>
        <State label="No changes">
          <DiffView mode="code" files={[]} />
        </State>
      </Section>
      <Section
        id="impact-summary"
        title="Impact summary"
        description="One block per evaluated flag, the promoted flag first. Each number filters the identity table."
      >
        <State label="Promoted flag and a dependent" wide>
          <ImpactSummary blocks={impactBlocks} />
        </State>
        <State label="Nothing evaluated">
          <ImpactSummary blocks={[]} />
        </State>
      </Section>
    </>
  );
}

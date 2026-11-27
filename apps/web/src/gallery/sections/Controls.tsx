import { useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Choice, FilterChip } from '../../components/Choice';
import { ConfirmGate } from '../../components/ConfirmGate';
import { SelectField, TextField } from '../../components/Field';
import { RouteBullet } from '../../components/RouteBullet';
import { Section, State } from '../Specimen';

const environments = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
];

/** Buttons, inputs and the confirmation gate (ui-design.md 5, 6.6). */
export function Controls() {
  const [chips, setChips] = useState({ release: true, stuck: false });
  const [production, setProduction] = useState('production');
  const [applied, setApplied] = useState(0);
  return (
    <>
      <Section
        id="buttons"
        title="Buttons"
        description="Square buttons with plain verbs. A disabled button keeps focus and states its reason in a tooltip and beside it."
      >
        <State label="Primary">
          <Button>Sync now</Button>
          <Button icon="sync">Scan now</Button>
        </State>
        <State label="Secondary">
          <Button variant="secondary">Discard dry run</Button>
          <ButtonLink href="#promote" icon="promote">
            Promote
          </ButtonLink>
        </State>
        <State label="Danger">
          <Button variant="danger" icon="retire">
            Open pull requests
          </Button>
        </State>
        <State label="Disabled with its reason">
          <Button icon="archive" disabledReason="Archive is blocked: 2 possible references remain.">
            Archive
          </Button>
        </State>
      </Section>
      <Section
        id="inputs"
        title="Inputs"
        description="2px ink border, paper-raised fill, and the 3px line-colour focus ring with a 2px paper offset."
      >
        <State label="Text, with a hint">
          <TextField label="Email" type="email" hint="The email of your Flagsmith account." />
        </State>
        <State label="Mono, filled">
          <TextField label="Flagsmith URL" mono defaultValue="http://localhost:8000" />
        </State>
        <State label="Validation error">
          <TextField
            label="Exit plan deadline"
            mono
            defaultValue="2026-02-30"
            error="2026-02-30 is not a calendar date. Use YYYY-MM-DD."
          />
        </State>
        <State label="Search">
          <TextField
            label="Search flags"
            type="search"
            icon="search"
            placeholder="Press / to search"
          />
        </State>
        <State label="Select">
          <SelectField label="Source environment" options={environments} defaultValue="staging" />
        </State>
        <State label="Checkbox and radio">
          <div>
            <Choice type="checkbox" label="Acknowledge: not yet Ready for removal" />
            {environments.map((environment) => (
              <Choice
                key={environment.value}
                type="radio"
                name="production"
                label={`${environment.label} is production`}
                checked={production === environment.value}
                onChange={() => {
                  setProduction(environment.value);
                }}
              />
            ))}
          </div>
        </State>
        <State label="Filter chips, on and off">
          <FilterChip
            label={
              <>
                <RouteBullet type="release" /> Release
              </>
            }
            pressed={chips.release}
            onPressedChange={(pressed) => {
              setChips({ ...chips, release: pressed });
            }}
          />
          <FilterChip
            label="Stuck rollout"
            pressed={chips.stuck}
            onPressedChange={(pressed) => {
              setChips({ ...chips, stuck: pressed });
            }}
          />
        </State>
      </Section>
      <Section
        id="confirm-gate"
        title="Confirm gate"
        description="Apply is enabled only when the typed name matches exactly. Blocking problems replace the gate."
      >
        <State label="Production: typed name">
          <ConfirmGate
            sentence="Promote dark_mode from Staging to Production: 855 identities turn ON, 145 stay as they are."
            targetName="Production"
            confirmName="dark_mode"
            actionLabel="Apply to Production"
            onConfirm={() => {
              setApplied(applied + 1);
            }}
          />
          <p data-gallery-applied={applied}>Applied {applied} times.</p>
        </State>
        <State label="Not production: no typed name">
          <ConfirmGate
            sentence="Promote dark_mode from Development to Staging: no identity changes."
            targetName="Staging"
            confirmName={null}
            actionLabel="Apply to Staging"
            onConfirm={() => undefined}
          />
        </State>
        <State label="Applying">
          <ConfirmGate
            sentence="Promote dark_mode from Staging to Production."
            targetName="Production"
            confirmName={null}
            actionLabel="Apply to Production"
            onConfirm={() => undefined}
            busy
          />
        </State>
        <State label="Blocked">
          <ConfirmGate
            sentence="Promote dark_mode from Staging to Production."
            targetName="Production"
            confirmName="dark_mode"
            actionLabel="Apply to Production"
            onConfirm={() => undefined}
            blockers={[
              'Change requests are enabled on Production (minimum approvals: 0); Flagsmith refuses direct writes.',
              'Dependencies differ.',
              'Flagsmith would reject this configuration: Duplicate priority: 0.',
            ]}
          />
        </State>
      </Section>
    </>
  );
}

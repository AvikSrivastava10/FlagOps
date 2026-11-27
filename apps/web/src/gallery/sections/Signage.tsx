import { useState } from 'react';
import { Banner } from '../../components/Banner';
import { Notice } from '../../components/Notice';
import { SignageBar, navItems, type NavId, type SignageSession } from '../../components/SignageBar';
import { Section, State } from '../Specimen';

const hrefs = Object.fromEntries(navItems.map((item) => [item.id, `#nav-${item.id}`])) as Record<
  NavId,
  string
>;

const session: SignageSession = {
  projectName: 'FlagOps Demo · Demo shop',
  current: 'board',
  hrefs,
  sync: { state: 'synced', text: 'Synced 09:14' },
  user: 'avik@example.com',
  onSignOut: () => undefined,
};

/** The signage bar, banners and notices (ui-design.md 5, 6.11). */
export function Signage() {
  const [versionBanner, setVersionBanner] = useState(true);
  return (
    <>
      <Section
        id="signage-bar"
        title="Signage bar"
        description="The black band on every screen. The current plate turns to paper; sync status is a polite live region."
      >
        <State label="Signed in, synced" wide>
          <SignageBar homeHref="#board" mainId="gallery-main" session={session} />
        </State>
        <State label="Syncing, on Drift" wide>
          <SignageBar
            homeHref="#board"
            mainId="gallery-main"
            session={{ ...session, current: 'drift', sync: { state: 'syncing', text: 'Syncing' } }}
          />
        </State>
        <State label="Sync failed" wide>
          <SignageBar
            homeHref="#board"
            mainId="gallery-main"
            session={{
              ...session,
              current: 'status',
              sync: { state: 'failed', text: 'Sync failed 09:14' },
            }}
          />
        </State>
        <State label="Sign in: wordmark only" wide>
          <SignageBar homeHref="#board" mainId="gallery-main" />
        </State>
      </Section>
      <Section
        id="banner"
        title="Banner"
        description="Full-width bands under the signage bar for connection problems, stale data and a version mismatch."
      >
        <State label="Flagsmith unreachable" wide>
          <Banner tone="danger" glyph="sync">
            Flagsmith unreachable at <code>http://localhost:8000</code> since 09:20. Showing data
            from the sync at 09:14.
          </Banner>
        </State>
        <State label="GitHub rate limit" wide>
          <Banner tone="danger">
            GitHub rate limit reached. Scans resume at 10:02, when the limit resets.
          </Banner>
        </State>
        <State label="Stale data" wide>
          <Banner tone="notice" glyph="stuck-rollout">
            Showing data from the sync at 09:14. The next sync runs in 15 seconds.
          </Banner>
        </State>
        <State label="Version mismatch, dismissible" wide>
          {versionBanner ? (
            <Banner
              tone="notice"
              onDismiss={() => {
                setVersionBanner(false);
              }}
            >
              Flagsmith 2.296.0 is newer than the tested 2.295.2. Writes still read back every
              change.
            </Banner>
          ) : (
            <p>Dismissed.</p>
          )}
        </State>
      </Section>
      <Section
        id="notice"
        title="Notice"
        description="Service notices: yellow with ink, and the danger variant in red with white text."
      >
        <State label="Health condition">
          <Notice glyph="stuck-rollout" title="Stuck rollout">
            No stage change for 38 days (threshold 30, from Flagsmith). Exit plan deadline
            2026-11-02 passed 25 days ago.
          </Notice>
        </State>
        <State label="Inverted drift">
          <Notice glyph="inverted-drift" title="Inverted drift">
            Production: ON for segment staff; Development: OFF for everyone.
          </Notice>
        </State>
        <State label="Error with code and request ID">
          <Notice
            tone="danger"
            title="GitHub rejected the token (401)"
            code="github_unauthorized"
            requestId="req_7f3a9c"
          >
            Scans and Retire are paused. Check <code>GITHUB_TOKEN</code> in .env, then restart
            FlagOps.
          </Notice>
        </State>
        <State label="Stages unavailable">
          <Notice title="Stages unavailable: the project has no environments">
            Create an environment in Flagsmith, then <a href="#sync">sync now</a>.
          </Notice>
        </State>
      </Section>
    </>
  );
}

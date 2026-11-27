import { cx } from '../lib/class-names';
import { Icon, type IconName } from './icons/Icon';
import { Link } from './Link';
import styles from './SignageBar.module.css';

/** The primary navigation, in this order (ui-design.md 5). */
export const navItems = [
  { id: 'board', label: 'Board' },
  { id: 'drift', label: 'Drift' },
  { id: 'departures', label: 'Departures' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'audit', label: 'Audit' },
  { id: 'status', label: 'Status' },
  { id: 'settings', label: 'Settings' },
] as const;

export type NavId = (typeof navItems)[number]['id'];

export type SyncStatus = {
  state: 'synced' | 'syncing' | 'failed';
  /** For example "Synced 09:14" or "Sync failed 09:14". */
  text: string;
};

export type SignageSession = {
  projectName: string | null;
  current: NavId | null;
  hrefs: Readonly<Record<NavId, string>>;
  sync: SyncStatus;
  user: string;
  onSignOut: () => void;
};

export type SignageBarProps = {
  homeHref: string;
  /** The id of the main content, the skip link's target (ui-design.md 8). */
  mainId: string;
  /** Left out on the sign-in screen, which shows the wordmark only (ui-design.md 6.1). */
  session?: SignageSession | undefined;
};

const syncGlyphs: Readonly<Record<SyncStatus['state'], IconName>> = {
  synced: 'lamp-on',
  syncing: 'sync',
  failed: 'lamp-off',
};

/**
 * The black band at the top of every screen (ui-design.md 5): the skip link, the wordmark in the
 * sign face, the project, the navigation as sign plates, the sync status, which is announced
 * politely, the signed-in user and sign-out.
 */
export function SignageBar({ homeHref, mainId, session }: SignageBarProps) {
  return (
    <header className={styles.bar}>
      <a className={styles.skip} href={`#${mainId}`}>
        Skip to main content
      </a>
      <div className={styles.inner}>
        <Link href={homeHref} className={styles.wordmark}>
          <Icon name="interchange-ring" className={styles.mark} />
          FlagOps
        </Link>
        {session !== undefined && (
          <>
            {session.projectName !== null && (
              <p className={styles.project}>{session.projectName}</p>
            )}
            <nav className={styles.nav} aria-label="Primary">
              <ul className={styles.plates}>
                {navItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={session.hrefs[item.id]}
                      className={styles.plate}
                      aria-current={session.current === item.id ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className={styles.meta}>
              <p
                className={cx(styles.sync, session.sync.state === 'failed' && styles.syncFailed)}
                role="status"
              >
                <Icon name={syncGlyphs[session.sync.state]} className={styles.syncGlyph} />
                {session.sync.text}
              </p>
              <p className={styles.user}>{session.user}</p>
              <button type="button" className={styles.signOut} onClick={session.onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

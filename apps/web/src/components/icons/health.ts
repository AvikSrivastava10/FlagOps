import type { HealthId } from '@flagops/shared';
import type { IconName } from './glyphs';

/** The notice glyph of each health condition (ui-design.md 4). */
export const healthGlyphs: Readonly<Record<HealthId, IconName>> = {
  stuck_rollout: 'stuck-rollout',
  inverted_drift: 'inverted-drift',
  zombie_reference: 'zombie-reference',
  ghost: 'ghost',
  reused_name: 'reused-name',
  missing_exit_plan: 'missing-exit-plan',
};

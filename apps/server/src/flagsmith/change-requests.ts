import type { Environment } from './environments.js';

/**
 * Whether Flagsmith refuses direct writes to the environment. Flagsmith's `is_workflow_enabled`
 * is `minimum_change_request_approvals is not None`, so 0 blocks too (architecture.md 6.5).
 * Promotion, rollback, the seed and the status page all use this one predicate.
 */
export function changeRequestsBlockWrites(
  environment: Pick<Environment, 'minimum_change_request_approvals'>,
): boolean {
  return environment.minimum_change_request_approvals !== null;
}

import { GitHubError } from './errors.js';

/** `owner/name`, the form of DEMO_REPO and of each GITHUB_REPOSITORIES entry (architecture.md 21). */
const repositoryPattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function isRepositoryName(value: string): boolean {
  const name = value.split('/')[1];
  return repositoryPattern.test(value) && name !== '.' && name !== '..';
}

/**
 * The allowlist every repository request passes before anything is sent (architecture.md 20).
 * GitHub treats owner and repository names case-insensitively, and so does the guard.
 */
export class RepoGuard {
  readonly #allowed: ReadonlySet<string>;

  constructor(repositories: readonly string[]) {
    for (const repository of repositories) {
      if (!isRepositoryName(repository)) {
        throw new Error(`"${repository}" is not an owner/name repository`);
      }
    }
    this.#allowed = new Set(repositories.map((repository) => repository.toLowerCase()));
  }

  check(repository: string): void {
    if (!this.#allowed.has(repository.toLowerCase())) {
      throw new GitHubError(
        'github_repo_not_allowed',
        `FlagOps may not touch ${repository}: it is not one of the configured repositories.`,
        { details: { repository } },
      );
    }
  }
}

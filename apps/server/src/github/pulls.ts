import { z } from 'zod';
import type { GitHubClient } from './client.js';

export type PullRequest = {
  number: number;
  url: string;
  headBranch: string;
  /** `owner/name` of the head branch's repository, or null when that fork was deleted. */
  headRepository: string | null;
};

const pullSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});

export async function listOpenPullRequests(
  client: GitHubClient,
  repository: string,
): Promise<PullRequest[]> {
  const pulls = await client.paginate({
    method: 'GET',
    repository,
    path: '/pulls',
    query: { state: 'open', per_page: 100 },
    schema: z.array(pullSchema),
  });
  return pulls.map((pull) => ({
    number: pull.number,
    url: pull.html_url,
    headBranch: pull.head.ref,
    headRepository: pull.head.repo?.full_name ?? null,
  }));
}

/** Closes a pull request without merging it. Its branch stays; nothing deletes branches. */
export async function closePullRequest(
  client: GitHubClient,
  repository: string,
  number: number,
): Promise<void> {
  await client.request({
    method: 'PATCH',
    repository,
    path: `/pulls/${number}`,
    createsContent: true,
    body: { state: 'closed' },
    schema: z.object({ state: z.literal('closed') }),
  });
}

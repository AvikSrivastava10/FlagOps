import { z } from 'zod';
import type { GitHubClient } from './client.js';

export type WorkflowRun = {
  id: number;
  event: string;
  /** `queued`, `in_progress`, `completed` and the other states GitHub reports. */
  status: string;
  /** Set once the run completes: `success`, `failure`, `cancelled` and so on. */
  conclusion: string | null;
  url: string;
  startedAt: string;
  updatedAt: string;
};

/** The GitHub Actions runs for a commit (architecture.md 7.2, "CI status"). */
export async function listRunsForCommit(
  client: GitHubClient,
  repository: string,
  sha: string,
): Promise<WorkflowRun[]> {
  const page = await client.request({
    method: 'GET',
    repository,
    path: '/actions/runs',
    query: { head_sha: sha, per_page: 50 },
    schema: z.object({
      workflow_runs: z.array(
        z.object({
          id: z.number().int(),
          event: z.string(),
          status: z.string(),
          conclusion: z.string().nullable(),
          html_url: z.string(),
          run_started_at: z.string(),
          updated_at: z.string(),
        }),
      ),
    }),
  });
  return page.workflow_runs.map((run) => ({
    id: run.id,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    startedAt: run.run_started_at,
    updatedAt: run.updated_at,
  }));
}

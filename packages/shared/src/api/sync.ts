import { z } from 'zod';

/**
 * `POST /api/sync` (202). `started`: a sync began now. `queued`: a sync is already running, and
 * another starts as soon as it finishes, so changes made in Flagsmith meanwhile are picked up.
 */
export const syncResponseSchema = z.object({ status: z.enum(['started', 'queued']) });

export type SyncResponse = z.infer<typeof syncResponseSchema>;

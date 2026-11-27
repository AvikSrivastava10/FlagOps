import { z } from 'zod';

/**
 * `POST /api/scans` (202): scan the tracked repositories now, or one of them. A repository whose
 * head commit and flag names have not changed since its last scan is skipped (architecture.md 8.5).
 */
export const scanRequestSchema = z.strictObject({
  repository: z.string().min(3).max(200).optional(),
});
export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const scanResponseSchema = z.object({ status: z.enum(['started', 'queued']) });
export type ScanResponse = z.infer<typeof scanResponseSchema>;

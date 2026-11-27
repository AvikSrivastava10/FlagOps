import { z } from 'zod';

/** `GET /api/health` (architecture.md 15). */
export const healthResponseSchema = z.object({ status: z.literal('ok') });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

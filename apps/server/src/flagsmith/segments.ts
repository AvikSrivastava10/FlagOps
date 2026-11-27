import { z } from 'zod';
import { parseResponse, readAllPages, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

export type SegmentCondition = { operator: string; property: string | null; value: string | null };

export type SegmentRule = {
  type: 'ALL' | 'ANY' | 'NONE';
  rules: SegmentRule[];
  conditions: SegmentCondition[];
};

const conditionSchema = z.object({
  operator: z.string(),
  property: z.string().nullable(),
  value: z.string().nullable(),
});

const ruleSchema: z.ZodType<SegmentRule> = z.lazy(() =>
  z.object({
    type: z.enum(['ALL', 'ANY', 'NONE']),
    rules: z.array(ruleSchema).default([]),
    conditions: z.array(conditionSchema).default([]),
  }),
);

const segmentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** The feature a feature-specific segment belongs to, else null. */
  feature: z.number().int().nullable(),
  rules: z.array(ruleSchema),
  /** "" for segments people manage; cohort, experiment or release_pipeline otherwise. */
  managed_by: z.string().nullable(),
});

export type Segment = z.infer<typeof segmentSchema>;

const segmentPageSchema = z.object({
  next: z.string().nullable(),
  results: z.array(segmentSchema),
});

/**
 * Every listed segment of the project, feature-specific ones included. Flagsmith never lists
 * system segments, such as those it writes for flag dependencies (architecture.md 5.1).
 */
export async function listSegments(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
): Promise<Segment[]> {
  const path = '/api/v1/projects/{project_pk}/segments/';
  return readAllPages(async (page) => {
    const { data } = await client.api.GET(path, {
      params: {
        path: { project_pk: projectId },
        query: { include_feature_specific: true, page, page_size: 999 },
      },
      headers: authHeaders(credential),
    });
    return parseResponse(client, segmentPageSchema, data, { method: 'GET', path });
  });
}

export type SegmentInput = { name: string; description: string; rules: SegmentRule[] };

export async function createSegment(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  input: SegmentInput,
): Promise<Segment> {
  const path = '/api/v1/projects/{project_pk}/segments/';
  const { data } = await client.api.POST(path, {
    params: { path: { project_pk: projectId } },
    body: input,
    headers: authHeaders(credential),
  });
  return parseResponse(client, segmentSchema, data, { method: 'POST', path });
}

/** Replaces a segment's description and rules; Flagsmith deletes the rules the body omits. */
export async function updateSegment(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  segmentId: number,
  input: SegmentInput,
): Promise<Segment> {
  const path = '/api/v1/projects/{project_pk}/segments/{id}/';
  const { data } = await client.api.PUT(path, {
    params: { path: { project_pk: projectId, id: segmentId } },
    body: input,
    headers: authHeaders(credential),
  });
  return parseResponse(client, segmentSchema, data, { method: 'PUT', path });
}

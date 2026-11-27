import { z } from 'zod';
import { parseResponse, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';

const rawValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();

const documentFeatureStateSchema = z.object({
  feature: z.object({ id: z.number().int(), name: z.string() }),
  enabled: z.boolean(),
  /** The value with its type: a number for integers, a string otherwise. */
  feature_state_value: rawValueSchema,
  feature_segment: z.object({ priority: z.number().int() }).nullable(),
  multivariate_feature_state_values: z.array(
    z.object({
      multivariate_feature_option: z.object({ id: z.number().int() }),
      percentage_allocation: z.number(),
    }),
  ),
  /**
   * The bucketing seed of multivariate splits. The sync does not need it; only the impact
   * preview's context builder checks it (architecture.md 6.5, 10.1).
   */
  django_id: z.number().int().nullable().optional(),
});

export type DocumentFeatureState = z.infer<typeof documentFeatureStateSchema>;

export type DocumentRule = {
  type: string;
  rules: DocumentRule[];
  conditions: { operator: string; property_: string | null; value: string | null }[];
};

const documentRuleSchema: z.ZodType<DocumentRule> = z.lazy(() =>
  z.object({
    type: z.string(),
    rules: z.array(documentRuleSchema),
    // The engine model names the property `property_`, unlike the segments API.
    conditions: z.array(
      z.object({
        operator: z.string(),
        property_: z.string().nullable(),
        value: z.string().nullable(),
      }),
    ),
  }),
);

const documentSegmentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  rules: z.array(documentRuleSchema),
  feature_states: z.array(documentFeatureStateSchema),
});

/** The part of an environment document FlagOps reads (architecture.md 5.1, 6.4). */
const environmentDocumentSchema = z.object({
  api_key: z.string(),
  feature_states: z.array(documentFeatureStateSchema),
  project: z.object({ segments: z.array(documentSegmentSchema) }),
  identity_overrides: z.array(
    z.object({
      identifier: z.string(),
      identity_features: z.array(documentFeatureStateSchema),
    }),
  ),
  /** False means the document carries no identity overrides; their count then comes from the feature list. */
  use_identity_overrides_in_local_eval: z.boolean(),
});

export type EnvironmentDocument = z.infer<typeof environmentDocumentSchema>;

/** `GET /api/v1/environments/{api_key}/document/` with the organisation key. */
export async function getEnvironmentDocument(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  apiKey: string,
): Promise<EnvironmentDocument> {
  const path = '/api/v1/environments/{api_key}/document/';
  const { data } = await client.api.GET(path, {
    params: { path: { api_key: apiKey } },
    headers: authHeaders(credential),
  });
  return parseResponse(client, environmentDocumentSchema, data, { method: 'GET', path });
}

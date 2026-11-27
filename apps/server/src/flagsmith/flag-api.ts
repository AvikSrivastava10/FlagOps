import { FlagOpsError } from '@flagops/shared';
import { z } from 'zod';
import { changeRequestsBlockWrites } from './change-requests.js';
import { parseResponse, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { getEnvironment } from './environments.js';
import { unexpectedResponse } from './errors.js';

/**
 * Flagsmith's experimental declarative flag API (D-009), isolated in this file. It reads and
 * replaces a flag's whole configuration in one environment, in one transaction, with or without
 * v2 versioning. Tested against Flagsmith 2.295.2.
 */
const flagPath = '/api/__future__/environments/{environment_key}/features/{feature_id}/';

const valueSchema = z
  .object({ type: z.enum(['string', 'integer', 'boolean']), value: z.string() })
  .nullable();

/** A value as the flag API carries it: its type, and the value written as a string. */
export type FlagApiValue = z.infer<typeof valueSchema>;

const variantSchema = z.object({ id: z.number().int(), weight: z.number() });

const priorityError = 'every segment override needs an explicit priority';

function flagShape<V extends z.ZodType>(variants: V) {
  const state = z.object({ enabled: z.boolean(), value: valueSchema, variants });
  return z.object({
    environment_default: state,
    segment_overrides: z.array(
      state.extend({
        segment: z.object({ id: z.number().int() }),
        priority: z.number({ error: priorityError }).int(),
      }),
    ),
  });
}

/** A read always lists the variants, empty for a standard flag. */
const flagSchema = flagShape(z.array(variantSchema));

/**
 * A write lists variants only for multivariate flags: Flagsmith answers "Feature is not
 * multivariate" to any variant list, even an empty one, on a standard flag.
 */
const bodySchema = flagShape(z.array(variantSchema).exactOptional());

/** A flag in one environment, as the flag API reads it: system-segment overrides included. */
export type FlagApiConfig = z.infer<typeof flagSchema>;

/** A replacement configuration, as the flag API accepts it. */
export type FlagApiBody = z.infer<typeof bodySchema>;

export type FlagApiTarget = { environmentKey: string; featureId: number };

export async function getFlag(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  target: FlagApiTarget,
): Promise<FlagApiConfig> {
  const { data } = await client.api.GET(flagPath, {
    params: {
      path: { environment_key: target.environmentKey, feature_id: target.featureId },
    },
    headers: authHeaders(credential),
  });
  return parseResponse(client, flagSchema, data, { method: 'GET', path: flagPath });
}

/**
 * Refuses a body Flagsmith must not receive (architecture.md 6.6): an override on a system
 * segment, which Flagsmith answers with 409 and manages itself, or one without an explicit
 * priority, which would leave the order to Flagsmith.
 */
export function checkPutBody(body: unknown, listedSegmentIds: ReadonlySet<number>): FlagApiBody {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new FlagOpsError(
      'validation_failed',
      `FlagOps refused to send this flag configuration: ${parsed.error.issues[0]?.message ?? 'invalid body'}.`,
    );
  }
  const system = parsed.data.segment_overrides.find(
    (override) => !listedSegmentIds.has(override.segment.id),
  );
  if (system !== undefined) {
    throw new FlagOpsError(
      'validation_failed',
      `FlagOps refused to send this flag configuration: segment ${system.segment.id} is a system segment, whose overrides Flagsmith manages itself.`,
    );
  }
  return parsed.data;
}

type State = Pick<FlagApiBody['environment_default'], 'enabled' | 'value' | 'variants'>;

function sortedVariants(state: State): string {
  return JSON.stringify([...(state.variants ?? [])].sort((a, b) => a.id - b.id));
}

function sameState(a: State, b: State): boolean {
  return (
    a.enabled === b.enabled &&
    JSON.stringify(a.value) === JSON.stringify(b.value) &&
    sortedVariants(a) === sortedVariants(b)
  );
}

/** True when `actual` serves what `body` asks for; overrides on system segments are not compared. */
export function flagMatches(
  body: FlagApiBody,
  actual: FlagApiConfig,
  listedSegmentIds: ReadonlySet<number>,
): boolean {
  const listed = actual.segment_overrides.filter((override) =>
    listedSegmentIds.has(override.segment.id),
  );
  if (!sameState(body.environment_default, actual.environment_default)) {
    return false;
  }
  if (listed.length !== body.segment_overrides.length) {
    return false;
  }
  return body.segment_overrides.every((wanted) => {
    const found = listed.find((override) => override.segment.id === wanted.segment.id);
    return found !== undefined && found.priority === wanted.priority && sameState(wanted, found);
  });
}

/**
 * Replaces a flag's configuration in one environment (architecture.md 6.3): overrides on listed
 * segments that the body omits are deleted, and overrides on system segments keep their priority.
 * Before writing, it checks the body and refuses when the environment requires change requests,
 * which block writes whenever `minimum_change_request_approvals` is set, 0 included. After
 * writing, it reads the flag back and reports success only when Flagsmith serves what was sent.
 */
export async function putFlag(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  target: FlagApiTarget,
  body: FlagApiBody,
  listedSegmentIds: ReadonlySet<number>,
): Promise<FlagApiConfig> {
  const checked = checkPutBody(body, listedSegmentIds);
  const environment = await getEnvironment(client, credential, target.environmentKey);
  if (changeRequestsBlockWrites(environment)) {
    throw new FlagOpsError(
      'flagsmith_change_requests_enabled',
      `${environment.name} requires change requests (minimum_change_request_approvals is ${environment.minimum_change_request_approvals}), so FlagOps does not write to it.`,
    );
  }
  await client.api.PUT(flagPath, {
    params: {
      path: { environment_key: target.environmentKey, feature_id: target.featureId },
    },
    body: checked,
    headers: authHeaders(credential),
  });
  const readBack = await getFlag(client, credential, target);
  if (!flagMatches(checked, readBack, listedSegmentIds)) {
    throw unexpectedResponse(
      { method: 'PUT', path: flagPath },
      `a flag that does not serve the configuration just written in ${environment.name}`,
      client.observedVersion(),
    );
  }
  return readBack;
}

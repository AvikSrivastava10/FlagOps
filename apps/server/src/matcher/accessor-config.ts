import { posix } from 'node:path';
import { z } from 'zod';

/**
 * `flagops.json`, the optional accessor configuration at a repository's root (survey 4.3, D-063).
 * It declares the application's own flag accessors and injected clients, so the matcher follows
 * reads that do not call the SDK directly. Without the file, matching is unchanged.
 */
const reads = z.enum(['enabled', 'value', 'json-value', 'flag', 'flags-object']);
const sdk = z.enum(['client', 'node']);
const modulePath = z
  .string()
  .min(1)
  .transform((path) => posix.normalize(path).replace(/^\.\//, ''));

const common = {
  module: modulePath,
  export: z.string().min(1),
  reads,
  nameArg: z.number().int().min(0).max(20).default(0),
  fallbackArg: z.number().int().min(0).max(20).optional(),
  await: z.boolean().optional(),
  sdk: sdk.optional(),
  dropUnused: z.boolean().optional(),
};

const accessorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('function'), ...common }),
  z.strictObject({ kind: z.literal('method'), ...common, method: z.string().min(1) }),
  z.strictObject({ kind: z.literal('hook'), ...common }),
  z.strictObject({ kind: z.literal('hook-result'), ...common, member: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('component'),
    module: modulePath,
    export: z.string().min(1),
    nameProp: z.string().min(1),
    renders: z.literal('children'),
    elseProp: z.string().min(1).optional(),
    sdk: sdk.optional(),
    dropUnused: z.boolean().optional(),
  }),
]);

const configSchema = z.strictObject({
  version: z.literal(1),
  accessors: z.array(accessorSchema).max(200).default([]),
  clients: z
    .array(
      z.strictObject({
        expression: z.string().min(1).max(200),
        sdk: z.literal('client').default('client'),
      }),
    )
    .max(50)
    .default([]),
  exclude: z.array(z.string().min(1).max(200)).max(100).default([]),
});

export type AccessorEntry = z.infer<typeof accessorSchema>;
export type AccessorConfig = z.infer<typeof configSchema>;

/** A rejected file or entry, with the reason, for the status page and the dry run. */
export type AccessorProblem = { entry: string; reason: string };

export const accessorConfigPath = 'flagops.json';

export const emptyAccessorConfig: AccessorConfig = {
  version: 1,
  accessors: [],
  clients: [],
  exclude: [],
};

/** How the rule log and the evidence name an accessor: `via-accessor:<kind>:<module>#<export>`. */
export function accessorRuleId(entry: AccessorEntry): string {
  return `via-accessor:${entry.kind}:${entry.module}#${entry.export}`;
}

/** An entry as the status page names it: its position and what it declares. */
export function describeEntry(entry: AccessorEntry, index: number): string {
  const member =
    entry.kind === 'method'
      ? `.${entry.method}`
      : entry.kind === 'hook-result'
        ? `().${entry.member}`
        : '';
  return `accessors[${index}] (${entry.kind} ${entry.export}${member} in ${entry.module})`;
}

/**
 * Reads `flagops.json`. A file that is not valid JSON or does not match the schema is rejected as
 * a whole, with the first problem; matching then runs as if there were no file.
 */
export function parseAccessorConfig(text: string | undefined): {
  config: AccessorConfig;
  problems: AccessorProblem[];
} {
  if (text === undefined) {
    return { config: emptyAccessorConfig, problems: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'it does not parse';
    return {
      config: emptyAccessorConfig,
      problems: [{ entry: accessorConfigPath, reason: `It is not valid JSON: ${reason}.` }],
    };
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where =
      issue === undefined || issue.path.length === 0 ? 'the top level' : issue.path.join('.');
    return {
      config: emptyAccessorConfig,
      problems: [
        { entry: accessorConfigPath, reason: `At ${where}: ${issue?.message ?? 'invalid'}.` },
      ],
    };
  }
  return { config: parsed.data, problems: [] };
}

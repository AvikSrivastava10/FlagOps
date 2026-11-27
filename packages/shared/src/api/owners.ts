import { z } from 'zod';

/**
 * Owner mappings (architecture.md 8.5, 15): how CODEOWNERS owners map to Flagsmith. A user handle
 * (`@name`) maps to a Flagsmith user, a team handle (`@org/team`) to a permission group.
 */
const userHandle = z
  .string()
  .regex(/^@?[A-Za-z0-9-]+$/, 'must be a GitHub user handle such as @name');
const teamHandle = z
  .string()
  .regex(/^@?[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be a GitHub team handle such as @org/team');

export const ownerMappingSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    github: userHandle,
    kind: z.literal('user'),
    flagsmithUserId: z.number().int().positive(),
  }),
  z.strictObject({
    github: teamHandle,
    kind: z.literal('team'),
    flagsmithGroupId: z.number().int().positive(),
  }),
]);
export type OwnerMappingInput = z.infer<typeof ownerMappingSchema>;

/** `PUT /api/settings/owner-mappings` replaces every mapping. */
export const ownerMappingsSchema = z.strictObject({
  mappings: z.array(ownerMappingSchema).max(500),
});
export type OwnerMappings = z.infer<typeof ownerMappingsSchema>;

/** `GET /api/flagsmith/directory`: the organisation's users and groups, for mapping. */
export const directorySchema = z.object({
  users: z.array(
    z.object({
      id: z.number().int(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
    }),
  ),
  groups: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type Directory = z.infer<typeof directorySchema>;

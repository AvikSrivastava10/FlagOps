import {
  directorySchema,
  ownerMappingsSchema,
  type Directory,
  type OwnerMappingInput,
} from '@flagops/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuditActor } from '../../audit/audit.js';
import { sessionOf } from '../hooks/session.js';

/** What the owner-mapping routes need from the ownership service. */
export type OwnerMappingService = {
  directory(): Promise<Directory>;
  save(mappings: readonly OwnerMappingInput[], actor: AuditActor): Promise<OwnerMappingInput[]>;
};

/**
 * `GET /api/flagsmith/directory` lists the organisation's users and groups; `PUT
 * /api/settings/owner-mappings` replaces the mappings of CODEOWNERS owners onto them (15).
 */
export function ownerMappingRoutes(service: OwnerMappingService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/flagsmith/directory',
      { schema: { response: { 200: directorySchema } } },
      async () => service.directory(),
    );
    app.put(
      '/api/settings/owner-mappings',
      { schema: { body: ownerMappingsSchema, response: { 200: ownerMappingsSchema } } },
      async (request) => {
        const { user } = sessionOf(request);
        const actor: AuditActor = { kind: 'user', userId: user.id, email: user.email };
        return { mappings: await service.save(request.body.mappings, actor) };
      },
    );
  };
}

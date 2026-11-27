import { FlagOpsError } from '@flagops/shared';

type KeyOrganisation = { id: number; name: string };
type ManagedProject = { id: number; name: string; organisation: number };
type ManagedEnvironment = { name: string; api_key: string; project: number };

/**
 * The managed-project write guard (architecture.md 6.6 and 20). FlagOps writes only to the
 * project it manages, which belongs to the organisation of the API key:
 * - the code that selects the project hands it over with `manage()`: the sync in the server, the
 *   seed in its own process. `manage()` refuses a project of another organisation;
 * - every exported write function of the adapter checks its target before its first request, so
 *   a wrong ID never reaches Flagsmith, whichever credential the write uses.
 *
 * Until a project is managed, every write is refused. Only `createProject` comes before that, and
 * it takes its organisation from the key itself.
 */
export type WriteGuard = {
  /** Replaces what the guard admits: this project, its organisation and these environments. */
  manage(
    keyOrganisation: KeyOrganisation,
    project: ManagedProject,
    environments: readonly ManagedEnvironment[],
  ): void;
  checkOrganisation(organisationId: number): void;
  checkProject(projectId: number): void;
  checkEnvironment(environmentKey: string): void;
};

type Scope = { organisationId: number; project: ManagedProject; environmentKeys: Set<string> };

function refused(message: string): FlagOpsError {
  return new FlagOpsError('flagsmith_project_not_managed', message);
}

export function createWriteGuard(): WriteGuard {
  let scope: Scope | undefined;

  function check(target: string, admits: (current: Scope) => boolean): void {
    if (scope === undefined) {
      throw refused(
        `FlagOps refused a write to ${target}: it has not selected the Flagsmith project it manages yet. The first sync selects it.`,
      );
    }
    if (!admits(scope)) {
      throw refused(
        `FlagOps writes only to the Flagsmith project it manages, ${scope.project.name} (ID ${scope.project.id}), and refused a write to ${target}.`,
      );
    }
  }

  return {
    manage(keyOrganisation, project, environments) {
      if (project.organisation !== keyOrganisation.id) {
        throw refused(
          `The project ${project.name} (ID ${project.id}) belongs to organisation ${project.organisation}, not to ${keyOrganisation.name} (ID ${keyOrganisation.id}), the organisation of FLAGSMITH_ORG_API_KEY, so FlagOps does not write to it.`,
        );
      }
      const foreign = environments.find((environment) => environment.project !== project.id);
      if (foreign !== undefined) {
        throw refused(
          `The environment ${foreign.name} belongs to project ${foreign.project}, not to ${project.name} (ID ${project.id}).`,
        );
      }
      scope = {
        organisationId: keyOrganisation.id,
        project,
        environmentKeys: new Set(environments.map((environment) => environment.api_key)),
      };
    },
    checkOrganisation(organisationId) {
      check(
        `organisation ${organisationId}`,
        (current) => current.organisationId === organisationId,
      );
    },
    checkProject(projectId) {
      check(`project ${projectId}`, (current) => current.project.id === projectId);
    },
    checkEnvironment(environmentKey) {
      check(`the environment with client key ${environmentKey}`, (current) =>
        current.environmentKeys.has(environmentKey),
      );
    },
  };
}

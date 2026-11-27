// Tests replace `@flagsmith/nodejs` with this module (vi.mock), so they never reach Flagsmith.

type ServedFlag = { enabled: boolean; value?: string | number | boolean | null };

let served: Record<string, ServedFlag> = {};

/**
 * Every identity the API asked flags for, with the traits it sent. Flagsmith creates the identity
 * and stores its traits unless `transient` is true.
 */
export const identityRequests: { identifier: string; traits: unknown; transient: boolean }[] = [];

/** Sets the flags Flagsmith serves. A flag left out is off with no value. */
export function serveFlags(flags: Record<string, ServedFlag>): void {
  served = flags;
  identityRequests.length = 0;
}

/** Stands in for the SDK's client in remote evaluation. */
export class Flagsmith {
  async getIdentityFlags(identifier: string, traits?: Record<string, unknown>, transient = false) {
    identityRequests.push({ identifier, traits, transient });
    const flags = served;
    return {
      isFeatureEnabled: (name: string) => flags[name]?.enabled ?? false,
      getFeatureValue: (name: string) => flags[name]?.value ?? undefined,
    };
  }
}

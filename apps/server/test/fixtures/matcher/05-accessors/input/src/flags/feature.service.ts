import { Flagsmith } from '@flagsmith/nodejs';

const client = new Flagsmith({ environmentKey: process.env.FLAGSMITH_KEY });

export class FeatureService {
  async isOn(name: string): Promise<boolean> {
    const flags = await client.getEnvironmentFlags();
    return flags.isFeatureEnabled(name);
  }
}

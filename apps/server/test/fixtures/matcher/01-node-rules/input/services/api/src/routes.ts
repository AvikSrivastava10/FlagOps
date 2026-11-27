import { flagsmith } from './flags';

export async function handler(request: { flags: { isFeatureEnabled(name: string): boolean } }) {
  const flags = await flagsmith.getEnvironmentFlags();
  if (flags.isFeatureEnabled('new_checkout')) return 'new';
  const limit = flags.getFeatureValue('seat_limit');
  const banner = flags.getFlag('promo_banner').enabled;
  const variant = await flagsmith.getExperimentFlag('search_ranking', 'user-1');
  if (request.flags.isFeatureEnabled('New_Checkout')) return 'case differs';
  if (request.flags.isFeatureEnabled('new_checkout')) return 'by method name';
  return [limit, banner, variant];
}

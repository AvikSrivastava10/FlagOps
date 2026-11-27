import flagsmith from '@flagsmith/flagsmith';
import { useExperiment, useFlags } from '@flagsmith/flagsmith/react';

export function Scoped() {
  const { new_checkout } = useFlags(['new_checkout']);
  const flags = useFlags(['dark_mode']);
  const ranking = useExperiment('search_ranking');
  const on = flagsmith.hasFeature('New Checkout');
  const limit = flagsmith.getValue('SEAT_LIMIT', { fallback: 5 });
  const experiment = flagsmith.getExperimentFlag('search_ranking');
  return [new_checkout.enabled, flags.dark_mode.enabled, ranking, on, limit, experiment];
}

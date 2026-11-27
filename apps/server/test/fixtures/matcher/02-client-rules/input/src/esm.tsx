import flagsmith from 'flagsmith-es';
import { useFlags } from 'flagsmith-es/react';

export function Esm() {
  const { dark_mode } = useFlags(['dark_mode']);
  return dark_mode.enabled && flagsmith.hasFeature('new_checkout');
}

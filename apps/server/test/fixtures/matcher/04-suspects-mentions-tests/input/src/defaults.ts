import flagsmith from '@flagsmith/flagsmith';

await flagsmith.init({
  environmentID: 'client-key',
  defaultFlags: { new_checkout: { enabled: false } },
});

import flagsmith from '@flagsmith/flagsmith';

flagsmith.hasFeature('new_checkout');
flagsmith.hasFeature('typo_flag');
flagsmith.hasFeature(process.env.FLAG ?? '');

import flagsmith from '@flagsmith/flagsmith';

export const swapped = flagsmith.hasFeature('dakr');
export const twoEdits = flagsmith.hasFeature('recomendatons_v2');
export const threeEdits = flagsmith.hasFeature('fre_shiping_treshold');
export const tied = flagsmith.hasFeature('beta_c');
export const otherCase = flagsmith.getValue('FREE_SHIPPING_THRESHOLDS');

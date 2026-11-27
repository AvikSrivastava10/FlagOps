import flagsmith from '@flagsmith/flagsmith';

export const enabled = (names: string[]): boolean[] =>
  names.map((name) => flagsmith.hasFeature(name));

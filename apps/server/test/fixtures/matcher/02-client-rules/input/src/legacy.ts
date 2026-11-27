import flagsmith from 'flagsmith';
import type { IFlags } from 'flagsmith/types';

export const darkModeOn = (): boolean => flagsmith.hasFeature('dark_mode');

export function count(flags: IFlags): number {
  return Object.keys(flags).length;
}

import { flags } from './index';

export const isOn = (name: string): boolean => flags.hasFeature(name);

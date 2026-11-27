import type { Flags } from 'flagsmith-nodejs/build/sdk/models';

export function size(flags: Flags): number {
  return flags.allFlags().length;
}

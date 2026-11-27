import flagsmith from '@flagsmith/flagsmith';

let ready = false;

export function markReady(): void {
  ready = true;
}

/** Off until the flags have loaded, then whatever Flagsmith serves. */
export function isOn(name: string, fallback = false): boolean {
  if (!ready) {
    return fallback;
  }
  return flagsmith.hasFeature(name);
}

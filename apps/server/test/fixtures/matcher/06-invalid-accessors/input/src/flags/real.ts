/** Not a Flagsmith read: it never passes the name to the SDK. */
export function isOn(name: string): boolean {
  return name.endsWith('_on');
}

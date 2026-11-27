function isOn(name: string): boolean {
  return name.startsWith('x');
}

export const value = isOn('new_checkout');

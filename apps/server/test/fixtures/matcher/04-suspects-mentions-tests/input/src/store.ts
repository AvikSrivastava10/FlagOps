export const store = {
  hasFeature: (name: string): boolean => name.length > 0,
  getValue: (name: string): string => name,
};

export const key = (): string => 'settings';

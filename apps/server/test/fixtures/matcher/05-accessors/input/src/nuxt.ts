declare function useNuxtApp(): { $flags: { hasFeature(name: string): boolean } };

export function useSimilar(): boolean {
  const { $flags } = useNuxtApp();
  return $flags.hasFeature('similar_items');
}

import { useFeatures } from './flags/useFeatures';
import { useFeatureSet } from './flags/useFeatureSet';
export function Bundles() {
  const { gift_cards } = useFeatures(['gift_cards']);
  const features = useFeatureSet(['loyalty_points']);
  return [gift_cards.enabled, features.loyalty_points.enabled];
}

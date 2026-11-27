import { isOn, useFeatureFlag } from './flags';
import { useFeature } from './flags/useFeature';
import { useFlagChecks } from './flags/useFlagChecks';

export function App() {
  const a = isOn('new_checkout', true);
  const b = useFeatureFlag('dark_mode');
  const c = useFeature('dark_mode');
  const { isEnabled } = useFlagChecks();
  const d = isEnabled('export_csv');
  const checks = useFlagChecks();
  const e = checks.isEnabled('export_csv');
  return [a, b, c, d, e];
}

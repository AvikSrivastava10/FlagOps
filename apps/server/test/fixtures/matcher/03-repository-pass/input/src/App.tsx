import { flags, Flag, FLAGS } from './lib';
import { useFlag } from './lib/useFlag';
import { isOn } from './lib/wrappers';

export function App() {
  const a = flags.hasFeature(FLAGS.NewCheckout);
  const b = isOn(Flag.ExportCsv);
  const c = flags.hasFeature('beta_search');
  const d = useFlag('dark_mode');
  return [a, b, c, d];
}

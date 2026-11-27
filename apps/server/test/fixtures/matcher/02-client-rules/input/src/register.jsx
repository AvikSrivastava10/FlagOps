import { useFlagsmith } from 'flagsmith/react.js';

export function Register() {
  const fs = useFlagsmith();
  return fs.hasFeature('new_checkout') && <p>Sign up</p>;
}

import legacy from 'react-native-flagsmith';
import scoped from '@flagsmith/react-native';

export const limit = scoped.getValue('seat_limit');
export const dark = legacy.hasFeature('dark_mode');

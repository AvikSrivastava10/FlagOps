import { key, store } from './store';

export const shown = store.hasFeature('new_checkout');
export const value = store.getValue(key());

import { create } from 'zustand';
import { safeLocalStorageGet, safeLocalStorageSet } from '@utils/errorHandler';

export type ResourceDisplay = 'bars' | 'chart';
const STORAGE_KEY = 'vrykell-ssh-resource-display';

export function readResourceDisplay(): ResourceDisplay {
  return safeLocalStorageGet(STORAGE_KEY) === 'chart' ? 'chart' : 'bars';
}

/** One presentation preference follows the user across connections and restarts. */
export const useResourceDisplay = create<{ display: ResourceDisplay; setDisplay: (display: ResourceDisplay) => void }>(set => ({
  display: readResourceDisplay(),
  setDisplay: display => {
    safeLocalStorageSet(STORAGE_KEY, display);
    set({ display });
  },
}));

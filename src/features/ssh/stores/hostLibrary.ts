import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HostMetadata { group: string; tags: string[]; starred: boolean; resourceDisabled?: boolean }
export const EMPTY_HOST_METADATA: HostMetadata = { group: '', tags: [], starred: false };
export const useHostLibrary = create<{
  hosts: Record<string, HostMetadata>;
  update: (id: string, patch: Partial<HostMetadata>) => void;
}>()(persist(set => ({
  hosts: {},
  update: (id, patch) => set(state => ({ hosts: { ...state.hosts, [id]: { ...EMPTY_HOST_METADATA, ...state.hosts[id], ...patch } } })),
}), {
  name: 'vrykell-host-library', partialize: state => ({ hosts: state.hosts }),
  merge: (saved, current) => {
    const source = (saved as { hosts?: Record<string, Partial<HostMetadata>> } | null)?.hosts;
    const hosts: Record<string, HostMetadata> = {};
    if (source && typeof source === 'object') for (const [id, value] of Object.entries(source)) {
      if (value && typeof value === 'object') hosts[id] = { group: typeof value.group === 'string' ? value.group : '',
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) : [], starred: value.starred === true,
        ...(value.resourceDisabled === true ? { resourceDisabled: true } : {}) };
    }
    return { ...current, hosts };
  },
}));

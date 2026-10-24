import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface HostSystems {
  systems: Record<string, string>;
  remember: (id: string, system: string) => void;
}

/** Only authenticated system metadata is cached; opening a picker never probes a host. */
export const useHostSystems = create<HostSystems>()(persist(set => ({
  systems: {},
  remember: (id, system) => {
    if (!id || !system.trim()) return;
    set(state => state.systems[id] === system ? state : { systems: { ...state.systems, [id]: system.slice(0, 256) } });
  },
}), {
  name: 'vrykell-host-systems',
  partialize: state => ({ systems: state.systems }),
  merge: (saved, current) => {
    const value = (saved as Partial<HostSystems> | undefined)?.systems;
    const systems = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string').map(([id, system]) => [id, system.slice(0, 256)])) : {};
    return { ...current, systems };
  },
}));

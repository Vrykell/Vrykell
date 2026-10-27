export interface ResourcePlacement {
  target: HTMLElement;
  visible: boolean;
  focused: boolean;
  toolbarTarget?: HTMLElement | null;
  retainHeader?: boolean;
}

/** Slot registration must not rerender the components that own those slots. */
export function createResourcePlacements() {
  const owners = new Map<string, Map<symbol, ResourcePlacement>>();
  const snapshots = new Map<string, ResourcePlacement>();
  const listeners = new Map<string, Set<() => void>>();
  const publish = (id: string) => {
    const placements = owners.get(id);
    const next = placements && [...placements.values()].pop();
    const previous = snapshots.get(id);
    if (previous === next || previous && next && previous.target === next.target && previous.visible === next.visible
      && previous.focused === next.focused && previous.toolbarTarget === next.toolbarTarget && previous.retainHeader === next.retainHeader) return;
    if (next) snapshots.set(id, next); else snapshots.delete(id);
    for (const listener of listeners.get(id) ?? []) listener();
  };
  return {
    get: (id: string) => snapshots.get(id),
    subscribe: (id: string, listener: () => void) => {
      const subscriptions = listeners.get(id) ?? new Set<() => void>();
      subscriptions.add(listener); listeners.set(id, subscriptions);
      return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(id); };
    },
    register: (id: string, placement: ResourcePlacement) => {
      const key = Symbol();
      const placements = owners.get(id) ?? new Map<symbol, ResourcePlacement>();
      placements.set(key, placement); owners.set(id, placements); publish(id);
      return () => {
        if (!placements.delete(key)) return;
        if (!placements.size) owners.delete(id);
        publish(id);
      };
    },
  };
}

import { create } from 'zustand';
import { orderedWorkspaceIds } from '@features/workspace/stores/navigation';

interface AiWorkspaceState {
  nativeTabs: string[];
  selected: string;
  order: string[];
  openNative: (id: string) => void;
  select: (id: string) => void;
  closeNative: (id: string) => void;
  move: (ids: string[], id: string, over: string, after: boolean) => void;
}

/** Opening and closing navigation tabs never deletes a saved conversation. */
export const useAiWorkspace = create<AiWorkspaceState>((set) => ({
  nativeTabs: [], selected: '', order: [],
  openNative: id => set(state => ({ nativeTabs: state.nativeTabs.includes(id) ? state.nativeTabs : [...state.nativeTabs, id], selected: `chat:${id}` })),
  select: selected => set({ selected }),
  closeNative: id => set(state => ({ nativeTabs: state.nativeTabs.filter(item => item !== id), selected: state.selected === `chat:${id}` ? '' : state.selected })),
  move: (ids, id, over, after) => set(state => {
    if (id === over || !ids.includes(id) || !ids.includes(over)) return state;
    const order = orderedWorkspaceIds(ids, state.order).filter(item => item !== id);
    order.splice(order.indexOf(over) + (after ? 1 : 0), 0, id);
    return { order };
  }),
}));

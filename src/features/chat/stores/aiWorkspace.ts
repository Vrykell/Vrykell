import { create } from 'zustand';
import { orderedWorkspaceIds } from '@features/workspace/stores/navigation';

interface AiWorkspaceState {
  nativeTabs: string[];
  selected: string;
  sideSelected: string;
  sideSessions: string[];
  order: string[];
  openNative: (id: string) => void;
  ensureNative: (id: string) => void;
  select: (id: string) => void;
  selectSide: (id: string) => void;
  closeNative: (id: string) => void;
  move: (ids: string[], id: string, over: string, after: boolean) => void;
}

/** Opening and closing navigation tabs never deletes a saved conversation. */
export const useAiWorkspace = create<AiWorkspaceState>((set) => ({
  nativeTabs: [], selected: '', sideSelected: '', sideSessions: [], order: [],
  openNative: id => set(state => ({ nativeTabs: state.nativeTabs.includes(id) ? state.nativeTabs : [...state.nativeTabs, id], selected: `chat:${id}`, sideSessions: state.sideSessions.filter(item => item !== `chat:${id}`), ...(state.sideSelected === `chat:${id}` ? { sideSelected: '' } : {}) })),
  ensureNative: id => set(state => state.nativeTabs.includes(id) ? state : ({ nativeTabs: [...state.nativeTabs, id] })),
  select: selected => set(state => ({ selected, sideSessions: state.sideSessions.filter(item => item !== selected), ...(state.sideSelected === selected && selected ? { sideSelected: '' } : {}) })),
  selectSide: sideSelected => set(state => ({ sideSelected, sideSessions: sideSelected && !state.sideSessions.includes(sideSelected) ? [...state.sideSessions, sideSelected] : state.sideSessions, ...(sideSelected.startsWith('chat:') && !state.nativeTabs.includes(sideSelected.slice(5)) ? { nativeTabs: [...state.nativeTabs, sideSelected.slice(5)] } : {}) })),
  closeNative: id => set(state => ({ nativeTabs: state.nativeTabs.filter(item => item !== id), sideSessions: state.sideSessions.filter(item => item !== `chat:${id}`), selected: state.selected === `chat:${id}` ? '' : state.selected, sideSelected: state.sideSelected === `chat:${id}` ? '' : state.sideSelected })),
  move: (ids, id, over, after) => set(state => {
    if (id === over || !ids.includes(id) || !ids.includes(over)) return state;
    const order = orderedWorkspaceIds(ids, state.order).filter(item => item !== id);
    order.splice(order.indexOf(over) + (after ? 1 : 0), 0, id);
    return { order };
  }),
}));

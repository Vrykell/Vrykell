import { create } from 'zustand';
import type { SshConnection } from '../services/api';

export const useHostEditor = create<{
  draft: SshConnection | null | undefined;
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  open: (connection?: SshConnection) => void;
  close: () => void;
}>(set => ({ draft: undefined, quickOpen: false, setQuickOpen: quickOpen => set({ quickOpen }), open: connection => set({ draft: connection ?? null }), close: () => set({ draft: undefined }) }));

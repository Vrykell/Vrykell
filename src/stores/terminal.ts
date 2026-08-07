import { create } from 'zustand';
import { ptyWrite } from '../lib/pty';

interface TerminalState {
  sessionId: string | null;
  visible: boolean;
  setSession: (id: string) => void;
  toggle: () => void;
  runInTerminal: (command: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessionId: null,
  visible: true,
  setSession: (id) => set({ sessionId: id }),
  toggle: () => set((s) => ({ visible: !s.visible })),
  runInTerminal: (command) => {
    const { sessionId } = get();
    if (!sessionId) {
      set({ visible: true }); // 终端尚未就绪：先展开面板让用户看到
      return;
    }
    ptyWrite(sessionId, command.endsWith('\n') ? command : command + '\n').catch(() => {});
  },
}));

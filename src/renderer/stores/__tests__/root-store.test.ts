import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalStore } from '../terminal-store';
import type { SessionInfo } from '../../../shared/types/index';

describe('terminal store', () => {
  beforeEach(() => {
    useTerminalStore.setState(useTerminalStore.getInitialState?.() || {
      sessions: [], activeSessionId: null, richOutputs: {},
      settings: expect.any(Object),
      aiMessages: [], aiStreaming: false,
      sidebarOpen: false, outputPanelOpen: false, outputPanelHeight: 200,
    });
  });

  const makeSession = (id: string): SessionInfo => ({
    id,
    type: 'local',
    title: 'bash',
    cols: 80,
    rows: 24,
    createdAt: Date.now(),
  });

  it('adds session and sets active when empty', () => {
    const s = makeSession('s1');
    useTerminalStore.getState().addSession(s);
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
    expect(useTerminalStore.getState().activeSessionId).toBe('s1');
  });

  it('removes session and falls back active session', () => {
    useTerminalStore.getState().addSession(makeSession('s1'));
    useTerminalStore.getState().addSession(makeSession('s2'));
    useTerminalStore.getState().setActive('s2');
    useTerminalStore.getState().removeSession('s2');
    expect(useTerminalStore.getState().activeSessionId).toBe('s1');
  });

  it('updates session title', () => {
    useTerminalStore.getState().addSession(makeSession('s1'));
    useTerminalStore.getState().updateSessionTitle('s1', 'zsh');
    expect(useTerminalStore.getState().sessions[0].title).toBe('zsh');
  });

  it('appends and clears rich outputs per session', () => {
    useTerminalStore.getState().addSession(makeSession('s1'));
    const item = { id: '1', sessionId: 's1', type: 'code' as const, content: 'x', timestamp: 1 };
    useTerminalStore.getState().appendOutput('s1', item);
    expect(useTerminalStore.getState().richOutputs.s1).toHaveLength(1);
    useTerminalStore.getState().clearOutputs('s1');
    expect(useTerminalStore.getState().richOutputs.s1).toHaveLength(0);
  });

  it('deep-merges updateSettings for all groups', () => {
    useTerminalStore.getState().updateSettings({
      terminal: { fontSize: 20 },
      appearance: { theme: 'light' },
      richContent: { enableLatex: false },
      ai: { model: 'test' },
      ssh: { defaultUsername: 'root' },
    });
    const st = useTerminalStore.getState();
    expect(st.settings.terminal.fontSize).toBe(20);
    expect(st.settings.terminal.fontFamily).toBeDefined();
    expect(st.settings.appearance.theme).toBe('light');
    expect(st.settings.richContent.enableLatex).toBe(false);
    expect(st.settings.ai.model).toBe('test');
    expect(st.settings.ssh.defaultUsername).toBe('root');
  });
});

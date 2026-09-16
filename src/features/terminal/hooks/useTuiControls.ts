import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ptyWrite } from '@/platform/pty';
import { killForeground, ESCALATE_WINDOW_MS } from '@shared/utils/killForeground';
import { useToastStore } from '@/components/Toast';
import { useBlockStore, useTerminalStore, selectBlocks } from '@entities/terminal';

/** 管理 TUI 场景顶部工具条的交互和场景切换。 */
export function useTuiControls(tabId: string) {
  const setAltScreenActive = useTerminalStore((state) => state.setAltScreenActive);
  const setScene = useTerminalStore((state) => state.setScene);
  const altScreenActive = useTerminalStore((state) => state.altScreenActive);
  const sessions = useTerminalStore((state) => state.sessions);
  const blocks = useBlockStore(selectBlocks(tabId));
  const [killArmed, setKillArmed] = useState(false);
  const killTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (killTimer.current) clearTimeout(killTimer.current);
  }, []);

  const runningCommand = useMemo(() => {
    const running = blocks.filter((block) => block.status === 'executing');
    return running.length > 0 ? running[running.length - 1]!.command : '';
  }, [blocks]);

  const sendCtrlC = useCallback(() => {
    const sessionId = sessions[tabId];
    if (sessionId) ptyWrite(sessionId, '\x03').catch(() => {});
  }, [sessions, tabId]);

  const killApp = useCallback(() => {
    const sessionId = sessions[tabId];
    if (!sessionId) return;

    killForeground(sessionId)
      .then((level) => {
        if (killTimer.current) clearTimeout(killTimer.current);
        if (level === 'term') {
          setKillArmed(true);
          killTimer.current = setTimeout(() => setKillArmed(false), ESCALATE_WINDOW_MS);
        } else {
          setKillArmed(false);
        }
      })
      .catch((error) => useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'info'));
  }, [sessions, tabId]);

  const exitFullScreen = useCallback(() => {
    setAltScreenActive(false);
    setScene(tabId, 'blockList');
  }, [setAltScreenActive, setScene, tabId]);

  const enterFullScreen = useCallback(() => {
    setScene(tabId, 'altScreen');
    setAltScreenActive(true);
  }, [setAltScreenActive, setScene, tabId]);

  return {
    altScreenActive,
    runningCommand,
    killArmed,
    sendCtrlC,
    killApp,
    exitFullScreen,
    enterFullScreen,
  };
}

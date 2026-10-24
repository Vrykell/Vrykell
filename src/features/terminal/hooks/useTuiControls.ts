import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writeTerminalInput } from '@features/terminal/services/terminalWriteQueue';
import { killForeground, ESCALATE_WINDOW_MS } from '@utils/killForeground';
import { useToastStore } from '@ui/feedback/Toast';
import { useBlockStore, useTerminalStore, selectBlocks } from '@features/terminal';

/** Keep toolbar actions and manual presentation state scoped to their owning pane. */
export function useTuiControls(tabId: string) {
  const setManualFullscreen = useTerminalStore((state) => state.setManualFullscreen);
  const setScene = useTerminalStore((state) => state.setScene);
  const manualFullscreen = useTerminalStore((state) => !!state.manualFullscreen[tabId]);
  const sessions = useTerminalStore((state) => state.sessions);
  const blocks = useBlockStore(selectBlocks(tabId));
  const [killArmed, setKillArmed] = useState(false);
  const killTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (killTimer.current) clearTimeout(killTimer.current);
  }, []);

  const runningBlock = useMemo(() => {
    const running = blocks.filter((block) => block.status === 'executing');
    return running.length > 0 ? running[running.length - 1]! : null;
  }, [blocks]);
  const runningCommand = runningBlock?.command ?? '';

  const sendCtrlC = useCallback(() => {
    const sessionId = sessions[tabId];
    // Goes through the input queue: an interrupt leads whatever paste is still streaming.
    if (sessionId) writeTerminalInput(sessionId, '\x03').catch(() => {});
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
      .catch((error) => useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error'));
  }, [sessions, tabId]);

  const exitFullScreen = useCallback(() => {
    setManualFullscreen(tabId, false);
    setScene(tabId, 'blockList');
  }, [setManualFullscreen, setScene, tabId]);

  const enterFullScreen = useCallback(() => {
    useTerminalStore.getState().setFocusedPane(tabId);
    setScene(tabId, 'altScreen');
    setManualFullscreen(tabId, true);
  }, [setManualFullscreen, setScene, tabId]);

  return {
    manualFullscreen,
    runningCommand,
    runningCwd: runningBlock?.cwd,
    runningStartedAt: runningBlock?.startedAt ?? null,
    killArmed,
    sendCtrlC,
    killApp,
    exitFullScreen,
    enterFullScreen,
  };
}

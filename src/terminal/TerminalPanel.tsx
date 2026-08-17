import '@xterm/xterm/css/xterm.css';
import { useTerminalSession } from './useTerminalSession';

/** TerminalPanel — 单个终端 pane 的 xterm 宿主（classic 主表面 / altScreen 覆盖层）。 */
export default function TerminalPanel({
  paneId,
  tabId,
  onReady,
}: {
  paneId: string;
  tabId: string;
  onReady: (sessionId: string) => void;
}) {
  const ref = useTerminalSession(paneId, tabId, onReady);
  return (
    <div
      ref={ref}
      style={{ width: '100%', height: '100%', minHeight: 0, background: 'var(--canvas)' }}
    />
  );
}

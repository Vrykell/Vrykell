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
      // 背景透明：4px 边距由外层容器透出壁纸/画布（xterm 自身背景由 --xterm-bg 控制）
      style={{ width: '100%', height: '100%', minHeight: 0, background: 'transparent' }}
    />
  );
}

import { selectActiveSessionTab, useSessionStore } from '@entities/session';
import { MIN_PANE_SIZE, minTerminalWidth } from '@features/workspace/model/windowLayout';
import TopDock from '@/components/TopDock';
import SidePanel from '@/components/SidePanel';
import TerminalView from '@features/terminal/components/TerminalView';

/** 工作区主布局：Dock、侧边面板和终端内容区。 */
export default function WorkspaceShell() {
  const terminalMinWidth = useSessionStore((state) => {
    const tab = selectActiveSessionTab(state);
    return tab ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });

  return (
    <>
      <TopDock />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        <SidePanel side="left" />
        <main style={{ flex: 1, minWidth: terminalMinWidth, display: 'flex', flexDirection: 'column' }}>
          <TerminalView />
        </main>
        <SidePanel side="right" />
      </div>
    </>
  );
}

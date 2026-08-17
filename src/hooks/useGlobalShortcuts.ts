import { useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useTerminalStore, termInstances } from '../stores/terminal';
import { useTerminalLayoutStore } from '../stores/terminalLayout';
import { useUiStore } from '../stores/ui';
import { useBlockStore } from '../stores/blocks';

/**
 * 全局快捷键：
 * - Cmd/Ctrl+T 新建标签；Cmd/Ctrl+W 关闭当前标签
 * - Cmd/Ctrl+1..9 切换到第 N 个标签
 * - Cmd/Ctrl+F 打开全局搜索
 * - Ctrl+Shift+B 切换书签
 * - Cmd/Ctrl+, 打开设置
 * - Cmd/Ctrl+P 命令面板
 */

/** 缩放终端字号，同时更新所有 xterm 实例和全局字体大小。 */
function scaleFontSize(delta: 1 | -1 | 0) {
  const el = document.documentElement;
  const cur = parseFloat(el.style.fontSize || '14');
  let next: number;
  if (delta === 0) next = 14;
  else next = Math.max(10, Math.min(18, cur + delta));

  if (delta === 0) el.style.fontSize = '';
  else el.style.fontSize = `${next}px`;

  // 同步所有 xterm 实例的字号
  for (const t of termInstances.values()) {
    try { t.options.fontSize = next; } catch { /* ignore */ }
  }
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const activeId = useWorkspaceStore.getState().activeId;

      // Escape: 当键盘路由到终端且不在 TUI 全屏场景时，切回输入栏
      // （场景判定走 scenes —— altScreenActive 仅手动全屏，真 vim 里 Esc 必须进 PTY）
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const ts = useTerminalStore.getState();
        const scene = ts.scenes[activeId] ?? 'classic';
        if (ts.keyboardTarget === 'terminal' && scene !== 'altScreen') {
          e.preventDefault();
          e.stopPropagation();
          ts.setKeyboardTarget('input');
          return;
        }
      }

      // Cmd/Ctrl+/-/0: 字体缩放
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        if (e.key === '=') scaleFontSize(1);
        else if (e.key === '-') scaleFontSize(-1);
        else scaleFontSize(0);
        return;
      }

      // Cmd/Ctrl+P: 命令面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        useUiStore.getState().setPaletteOpen(true);
        return;
      }

      // Cmd/Ctrl+Shift+T: 撤销关闭标签
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        useWorkspaceStore.getState().undoCloseTab();
        return;
      }

      // Ctrl+Shift+B: 切换当前选中块的书签
      if (e.ctrlKey && e.shiftKey && !e.metaKey && e.key === 'B') {
        e.preventDefault();
        const blocks = useBlockStore.getState().byTab[activeId];
        if (blocks?.length) {
          const last = blocks[blocks.length - 1];
          if (last) useBlockStore.getState().toggleBookmark(activeId, last.id);
        }
        return;
      }

      // Cmd+F 或 Ctrl+F: 全局搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        useUiStore.getState().setGlobalSearchOpen(true);
        return;
      }

      // Cmd+] / Cmd+[ 在停靠终端间切换焦点（仅 Cmd，避免 Ctrl+[ = ESC 被劫持）
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === ']' || e.key === '[')) {
        const ws = useWorkspaceStore.getState();
        const layout = useTerminalLayoutStore.getState();
        const slots = layout.slots;
        const occupied = slots.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
        if (occupied.length >= 2) {
          e.preventDefault();
          const cur = slots.indexOf(ws.activeId);
          const idx = cur === -1 ? 0 : occupied.indexOf(cur);
          const next =
            e.key === ']'
              ? occupied[(idx + 1) % occupied.length]!
              : occupied[(idx - 1 + occupied.length) % occupied.length]!;
          const nextTabId = slots[next];
          if (nextTabId) ws.activate(nextTabId);
          return;
        }
      }

      if (!e.metaKey && !e.ctrlKey) return;
      const ws = useWorkspaceStore.getState();
      if (e.key === 't') {
        e.preventDefault();
        ws.addTab();
      } else if (e.key === 'd' || e.key === 'D') {
        // Cmd+D 把活跃标签停靠到下一个空槽位（仅终端标签）
        e.preventDefault();
        const tab = ws.tabs.find((t) => t.id === ws.activeId);
        if (tab && (tab.kind === 'local' || tab.kind === 'ssh')) {
          const layout = useTerminalLayoutStore.getState();
          if (!layout.isDocked(ws.activeId)) {
            const slot = layout.firstFreeSlot();
            if (slot !== null) layout.dockTab(ws.activeId, slot);
          }
        }
      } else if (e.key === 'w') {
        e.preventDefault();
        // 关闭当前标签（同时解除其停靠）
        ws.closeTab(ws.activeId);
      } else if (e.key === ',') {
        e.preventDefault();
        useWorkspaceStore.getState().openSettingsTab();
      } else if (/^[1-9]$/.test(e.key)) {
        const tab = ws.tabs[parseInt(e.key, 10) - 1];
        if (tab) {
          e.preventDefault();
          ws.activate(tab.id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

import { useEffect } from 'react';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useTerminalStore, getFocusedTerminalId } from '@features/terminal';
import { countLeaves, leaves } from '@features/workspace/model/windowLayout';
import { useUiStore } from '@features/workspace';
import { redrawTerminal } from '@features/terminal/services/terminalRepaint';

/**
 * 全局快捷键：
 * - Cmd/Ctrl+T 新建标签；Cmd/Ctrl+W 关闭当前标签
 * - Cmd/Ctrl+1..9 切换到第 N 个标签
 * - Cmd/Ctrl+F 打开全局搜索
 * - Cmd/Ctrl+, 打开设置
 * - Cmd/Ctrl+P 命令面板
 */

export function useGlobalShortcuts() {
  useEffect(() => {
    const redrawKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey
        || e.isComposing || e.keyCode === 229 || e.key.toLowerCase() !== 'r') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) redrawTerminal();
    };
    const paletteKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.isComposing
        || e.keyCode === 229 || e.key.toLowerCase() !== 'p') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) useUiStore.getState().setPaletteOpen(true);
    };
    const preventZoomKeys = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!['=', '+', '-', '0', 'Add', 'Subtract'].includes(e.key)
        && !['NumpadAdd', 'NumpadSubtract', 'Numpad0', 'NumpadEqual'].includes(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const preventZoomWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const preventZoomGesture = (e: Event) => e.preventDefault();
    // App-wide native-menu suppression: downstream handlers always see
    // `defaultPrevented`, so menu ownership travels through stopPropagation.
    const preventNativeContextMenu = (e: MouseEvent) => e.preventDefault();

    const handler = (e: KeyboardEvent) => {
      if (useUiStore.getState().settingsOpen) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'w')) {
          const ui = useUiStore.getState();
          if (!ui.paletteOpen && !ui.globalSearchOpen && !document.querySelector('[role="menu"], [role="listbox"]')) {
            e.preventDefault();
            useUiStore.getState().setSettingsOpen(false);
          }
          return;
        }
        if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
          useUiStore.getState().setSettingsOpen(false);
        }
        if (!((e.metaKey || e.ctrlKey) && e.key === 'f')) return;
      }
      // Escape: 当键盘路由到终端且不在 TUI 全屏场景时，切回输入栏
      // （场景判定走 scenes —— altScreenActive 仅手动全屏，真 vim 里 Esc 必须进 PTY）
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const ts = useTerminalStore.getState();
        const scene = ts.scenes[getFocusedTerminalId()] ?? 'classic';
        if (ts.keyboardTarget === 'terminal' && scene === 'blockList') {
          e.preventDefault();
          e.stopPropagation();
          ts.setKeyboardTarget('input');
          return;
        }
      }

      // Cmd/Ctrl+Shift+T: 撤销关闭标签
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        useSessionStore.getState().undoCloseTab();
        return;
      }

      // Cmd+F 或 Ctrl+F: 全局搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        useUiStore.getState().setGlobalSearchOpen(true);
        return;
      }

      // Cmd+] / Cmd+[ 在当前窗口的终端间切换焦点（仅 Cmd，避免 Ctrl+[ = ESC 被劫持）
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === ']' || e.key === '[')) {
        const ws = useSessionStore.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeId);
        if (tab && isSessionTab(tab) && countLeaves(tab.layout) >= 2) {
          e.preventDefault();
          const ids = leaves(tab.layout).map((t) => t.id);
          const cur = getFocusedTerminalId();
          const idx = Math.max(0, ids.indexOf(cur));
          const next = e.key === ']'
            ? ids[(idx + 1) % ids.length]!
            : ids[(idx - 1 + ids.length) % ids.length]!;
          useTerminalStore.getState().setFocusedPane(next);
          return;
        }
      }

      // ⌥⌘D：选择类型后再分裂（混搭 local/ssh）
      if (e.metaKey && e.altKey && !e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        useUiStore.getState().openSplitPicker();
        return;
      }

      if (!e.metaKey && !e.ctrlKey) return;
      const ws = useSessionStore.getState();
      if (e.key === 't') {
        e.preventDefault();
        ws.addTab();
      } else if (e.key === 'd') {
        // Cmd+D 分裂：进入落点选择（新终端继承类型）
        e.preventDefault();
        useUiStore.getState().beginSplit(null);
      } else if (e.key === 'D') {
        // Cmd+Shift+D：直接上下分裂（跳过落点选择）
        e.preventDefault();
        ws.splitFocusedDirect('col');
      } else if (e.key === 'w') {
        e.preventDefault();
        const tab = ws.tabs.find(value => value.id === ws.activeId);
        if (tab?.kind === 'git-diff') ws.closeGitComparison(tab.comparisons?.find(item => item.selection === tab.selection)?.id ?? tab.id);
        else if (tab?.kind === 'editor') ws.closeEditorFile(tab.selected);
        else if (tab && !isSessionTab(tab)) ws.closeTab(tab.id);
        else ws.closeFocusedTerminal();
      } else if (e.key === ',') {
        e.preventDefault();
        useSessionStore.getState().openSettings();
      } else if (/^[1-9]$/.test(e.key)) {
        const tab = ws.tabs[parseInt(e.key, 10) - 1];
        if (tab) {
          e.preventDefault();
          ws.activate(tab.id);
        }
      }
    };
    window.addEventListener('keydown', preventZoomKeys, true);
    window.addEventListener('keydown', redrawKey, true);
    window.addEventListener('keydown', paletteKey, true);
    window.addEventListener('wheel', preventZoomWheel, { capture: true, passive: false });
    window.addEventListener('gesturestart', preventZoomGesture, { capture: true, passive: false });
    window.addEventListener('gesturechange', preventZoomGesture, { capture: true, passive: false });
    window.addEventListener('gestureend', preventZoomGesture, { capture: true, passive: false });
    window.addEventListener('contextmenu', preventNativeContextMenu, true);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', preventZoomKeys, true);
      window.removeEventListener('keydown', redrawKey, true);
      window.removeEventListener('keydown', paletteKey, true);
      window.removeEventListener('wheel', preventZoomWheel, true);
      window.removeEventListener('gesturestart', preventZoomGesture, true);
      window.removeEventListener('gesturechange', preventZoomGesture, true);
      window.removeEventListener('gestureend', preventZoomGesture, true);
      window.removeEventListener('contextmenu', preventNativeContextMenu, true);
      window.removeEventListener('keydown', handler);
    };
  }, []);
}

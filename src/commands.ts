import { useSessionStore } from '@entities/session';
import { useBlockStore, termInstances } from '@entities/terminal';
import { useUiStore, useDockStore } from '@shared/ui';
import { clearSessionBlocks } from '@features/terminal/useTerminalSession';

/** 应用命令定义 — 被 CommandPalette 和全局搜索共用 */
export interface AppCommand {
  id: string;
  label: string;
  desc: string;
  keys?: string;
  keywords?: string[]; // 额外的搜索关键词
  action: () => void;
}

/** 注册的命令列表（单例） */
const _commands: AppCommand[] = [];

/** 注册一个命令 */
export function registerCommand(cmd: AppCommand) {
  // 防止重复注册
  if (!_commands.some((c) => c.id === cmd.id)) {
    _commands.push(cmd);
  }
}

/** 获取所有已注册的命令 */
export function getCommands(): AppCommand[] {
  return _commands;
}

/** 按 query 搜索命令 */
export function searchCommands(query: string): AppCommand[] {
  const lower = query.toLowerCase();
  return _commands.filter(
    (c) =>
      c.label.toLowerCase().includes(lower) ||
      c.desc.toLowerCase().includes(lower) ||
      (c.keywords?.some((k) => k.toLowerCase().includes(lower)) ?? false),
  );
}

// ── 注册所有命令 ──

function scaleFont(delta: 1 | -1 | 0) {
  const el = document.documentElement;
  const cur = parseFloat(el.style.fontSize || '15');
  let next: number;
  if (delta === 0) next = 15;
  else next = Math.max(10, Math.min(18, cur + delta));
  if (delta === 0) el.style.fontSize = '';
  else el.style.fontSize = `${next}px`;
  for (const t of termInstances.values()) {
    try { t.options.fontSize = next; } catch { /* ignore */ }
  }
}

function getActiveId() {
  return useSessionStore.getState().activeId;
}

registerCommand({ id: 'new-tab', label: '新建标签页', desc: '创建新的终端标签页', keys: '⌘T', keywords: ['tab', 'new'], action: () => useSessionStore.getState().addTab() });
registerCommand({ id: 'close-tab', label: '关闭当前标签页', desc: '关闭活跃标签页', keys: '⌘W', keywords: ['close', 'tab'], action: () => useSessionStore.getState().closeTab(getActiveId()) });
registerCommand({ id: 'undo-close-tab', label: '恢复关闭的标签页', desc: '撤销关闭标签操作', keys: '⌘⇧T', keywords: ['undo', 'tab', 'restore'], action: () => useSessionStore.getState().undoCloseTab() });
registerCommand({ id: 'toggle-files', label: '切换文件面板', desc: '在左侧显示或隐藏文件管理面板', keywords: ['files', 'panel'], action: () => useDockStore.getState().togglePanel('left', 'files') });
registerCommand({ id: 'toggle-bookmark', label: '切换书签', desc: '给当前块添加或移除书签', keys: 'Ctrl+Shift+B', keywords: ['bookmark'], action: () => {
  const blocks = useBlockStore.getState().byTab[getActiveId()];
  if (blocks?.length) {
    const last = blocks[blocks.length - 1];
    if (last) useBlockStore.getState().toggleBookmark(getActiveId(), last.id);
  }
}});
registerCommand({ id: 'open-settings', label: '打开设置', desc: '配置 API Key、模型与编辑器', keys: '⌘,', keywords: ['settings', 'config', 'api'], action: () => useSessionStore.getState().openSettingsTab() });
registerCommand({ id: 'clear-blocks', label: '清除输出块', desc: '清空当前标签的所有命令块', keywords: ['clear', 'reset'], action: () => clearSessionBlocks(getActiveId()) });
registerCommand({ id: 'font-inc', label: '增大字号', desc: '终端字体变大', keys: '⌘+', keywords: ['font', 'bigger', 'zoom'], action: () => scaleFont(1) });
registerCommand({ id: 'font-dec', label: '减小字号', desc: '终端字体变小', keys: '⌘-', keywords: ['font', 'smaller', 'zoom'], action: () => scaleFont(-1) });
registerCommand({ id: 'font-reset', label: '重置字号', desc: '恢复默认字体大小', keys: '⌘0', keywords: ['font', 'reset', 'zoom'], action: () => scaleFont(0) });
registerCommand({ id: 'global-search', label: '全局搜索', desc: '搜索文件、命令、设置等', keys: '⌘F', keywords: ['search', 'find'], action: () => useUiStore.getState().setGlobalSearchOpen(true) });

import { create } from 'zustand';
import { defaultOpenModeForShell, useAgentSettings } from '@/agent/agentSettings';
import { useToastStore } from '@/components/Toast';
import { t } from '@/i18n';
import type { BackendGroupEntry } from '@/search/types';
import {
  groupArchive,
  groupCreate,
  groupDelete,
  groupDeleteWithSessions,
  groupRename,
  groupRestore,
  groupSetCollapsed,
  groupsList,
  groupsReorder,
  sessionSetGroup,
  sessionsReorder,
} from '@/services/api/group';
import * as sessionManager from '@/services/tauri/sessionManager';
import type { ShellType } from '@/services/tauri/shells';
import { shellTypeLabel } from '@/services/tauri/shells';
import {
  countLeaves,
  findLeaf,
  firstLeaf,
  leaves as layoutLeaves,
  leaf,
  removeLeaf,
  type SplitDir,
  splitLeaf,
  type TerminalSpec,
  type WindowLayout,
} from '@/services/tauri/windowLayout';
import { useBlockStore } from '@/store/blocks';
import { useChatStore } from '@/store/chat';
import { getFocusedTerminalId, useTerminalStore } from '@/store/terminal';

export type TabKind = 'session' | 'history' | 'settings';

/** SSH 会话目标（终端类型=ssh 时的专属字段） */
export interface SshTabTarget {
  name: string;
  host: string;
  user?: string;
  port?: number;
  /** 关联的 SSH 连接 id（用于回查密码等完整配置） */
  connectionId?: string;
}

interface TabBase {
  id: string;
  title: string;
  /** 标题是否已定名（true 时不被「首条命令/消息」自动改名） */
  named?: boolean;
  /** 标题来自自动命名（截断兜底或 AI 智能标题）；手动 renameTab 后为 false/缺省。
   *  智能标题（M7 autoTitle）只覆盖未定名或自动命名的标签，尊重手动命名 */
  titleAuto?: boolean;
}

/**
 * 标签判别联合：
 *  - session 是「窗口」（真实会话容器，可落库、可分组、进历史），持有 1–4 个终端的布局
 *  - history / settings 是临时视图（单例复用，不落库、不可分组）
 */
export type Tab =
  | (TabBase & { kind: 'session'; groupId?: string; layout: WindowLayout })
  | (TabBase & { kind: 'history' })
  | (TabBase & { kind: 'settings' });

export interface TabGroup {
  id: string;
  title: string;
  collapsed: boolean;
}

export interface AddTabOptions {
  cwd?: string;
  title?: string;
  /** 默认 'local'；'history'/'settings' 用于视图标签 */
  kind?: 'local' | 'ssh' | 'history' | 'settings';
  shellType?: ShellType;
  /** SSH 连接目标（kind='ssh' 时） */
  ssh?: SshTabTarget;
  /** 归属分组 id */
  groupId?: string;
}

/** 是否为真实会话窗口（可落库、可分组） */
export function isSessionTab(tab: Tab): tab is Extract<Tab, { kind: 'session' }> {
  return tab.kind === 'session';
}

/** 窗口内全部终端 */
export function terminalsOf(tab: Tab): TerminalSpec[] {
  return isSessionTab(tab) ? layoutLeaves(tab.layout) : [];
}

/** 窗口内第一个终端（用于标题/图标等展示） */
export function firstTerminalOf(tab: Tab): TerminalSpec | null {
  return isSessionTab(tab) ? firstLeaf(tab.layout) : null;
}

/** 聚焦终端的当前工作目录（运行时 terminalCwds，回退到终端 spec.cwd）。 */
export function getFocusedCwd(): string | undefined {
  const ws = useWorkspaceStore.getState();
  const termId = getFocusedTerminalId();
  const activeTab = ws.tabs.find((t) => t.id === ws.activeId);
  if (activeTab && isSessionTab(activeTab)) {
    const spec = layoutLeaves(activeTab.layout).find((t) => t.id === termId);
    return ws.terminalCwds[termId] ?? spec?.cwd;
  }
  return undefined;
}

/** 把真实会话窗口序列化成后端 { kind, payload }；视图标签返回 null。 */
export function serializeSession(tab: Tab): { kind: string; payload: string } | null {
  if (!isSessionTab(tab)) return null;
  return { kind: 'session', payload: JSON.stringify({ layout: tab.layout }) };
}

/** 生成窗口内下一个终端的稳定 id（${windowId}#n）。 */
export function nextTerminalId(windowId: string, layout: WindowLayout): string {
  let max = -1;
  for (const t of layoutLeaves(layout)) {
    const m = /#(\d+)$/.exec(t.id);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${windowId}#${max + 1}`;
}

/** 克隆布局树，为新窗口重新生成终端 id（${newWindowId}#0/#1/…）。 */
function cloneLayout(layout: WindowLayout, newWindowId: string): WindowLayout {
  let n = 0;
  const clone = (node: WindowLayout): WindowLayout => {
    if (node.type === 'leaf') {
      return { ...node, terminal: { ...node.terminal, id: `${newWindowId}#${n++}` } };
    }
    return { ...node, first: clone(node.first), second: clone(node.second) };
  };
  return clone(layout);
}

// 标签 id 跨重启唯一（时间戳前缀 + 自增），避免重启后与历史会话 id 碰撞
const ID_PREFIX = Date.now().toString(36);
let counter = 0;
const nextTabId = () => `t${ID_PREFIX}-${counter++}`;
const DEFAULT_TITLE = '终端';
const HISTORY_TITLE = '会话历史';
const SETTINGS_TITLE = '设置';

interface WorkspaceState {
  tabs: Tab[];
  activeId: string;
  /** 最近关闭的标签（撤销关闭用，不参与 UI 渲染） */
  lastClosed: Tab | null;
  addTab: (opts?: AddTabOptions) => string;
  /** 新建一个会话历史查看标签页 */
  openHistoryTab: () => void;
  /** 新建/复用设置标签页 */
  openSettingsTab: () => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  /** 用首条用户消息命名标签；已定名则不覆盖 */
  titleFromMessage: (id: string, text: string) => void;
  /** 用首条命令命名标签（惯用命名范式）；已定名则不覆盖 */
  titleFromCommand: (id: string, text: string) => void;
  /** M7 智能标题：只覆盖未定名/自动命名的标题（手动命名不动） */
  autoTitle: (id: string, title: string) => void;
  renameTab: (id: string, title: string) => void;
  undoCloseTab: () => void;
  /** 更新某终端的当前工作目录（从 shell OSC 7 检测），keyed by 终端 id */
  setTerminalCwd: (terminalId: string, cwd: string) => void;
  /** 终端运行时 cwd（keyed by 终端 id，不落库） */
  terminalCwds: Record<string, string>;
  /** 移除终端时清理其 cwd 残留 */
  dropTerminalCwd: (terminalId: string) => void;
  /** 更新窗口的终端布局（分裂/移除/替换/调比例），并持久化 */
  setWindowLayout: (id: string, layout: WindowLayout) => void;
  /** 直接分裂聚焦终端（继承类型，跳过落点选择；⌘⇧D 用） */
  splitFocusedDirect: (dir: SplitDir) => void;
  /** 关闭指定终端；若只剩一个则关闭窗口 */
  closeTerminal: (terminalId: string) => void;
  /** 关闭聚焦终端；若只剩一个则关闭窗口 */
  closeFocusedTerminal: () => void;

  // ── 分组 ──
  groups: TabGroup[];
  /** 从后端加载分组列表 */
  loadGroups: () => Promise<void>;
  /** 新建分组，返回分组 id */
  createGroup: (title: string) => Promise<string>;
  /** 在某个标签上右键新建分组：新建分组并把该标签移入，返回分组 id */
  createGroupForTab: (tabId: string, title?: string) => Promise<string>;
  renameGroup: (id: string, title: string) => void;
  toggleGroupCollapse: (id: string) => void;
  /** 删除分组；withSessions=true 时连组内历史会话一起删 */
  deleteGroup: (id: string, withSessions: boolean) => Promise<void>;
  /** 拖动分组重排：把 id 移到 toIndex */
  moveGroup: (id: string, toIndex: number) => void;
  /** 拖动标签：移到 targetGroupId（null=未分组）的第 index 位 */
  moveTab: (tabId: string, targetGroupId: string | null, index: number) => void;
  /** 复制会话：以相同终端配置（类型/SSH 目标/cwd/布局）克隆一个新标签页 */
  duplicateTab: (tabId: string) => void;
  /** 清理没有任何活跃标签的空分组（空分组无意义，直接删除） */
  pruneEmptyGroups: () => void;
  /** 恢复分组内全部历史会话为标签页 */
  restoreGroup: (id: string) => Promise<void>;
  /** 归档分组：组内活跃标签全部关闭并移入会话历史，组本身保留 */
  archiveGroup: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // 初始无标签：默认终端由 App 启动逻辑创建（优先恢复上次会话，无恢复才创建默认）
  tabs: [],
  activeId: '',
  lastClosed: null,
  groups: [],
  terminalCwds: {},
  addTab: (opts) => {
    const o = opts ?? {};
    const id = nextTabId();
    const isSsh = o.kind === 'ssh' || !!o.ssh;
    const ssh = isSsh ? (o.ssh ?? { name: DEFAULT_TITLE, host: '' }) : null;

    let tab: Tab;
    if (isSsh) {
      const term: TerminalSpec = {
        id: `${id}#0`,
        kind: 'ssh',
        cwd: o.cwd,
        openMode: useAgentSettings.getState().global.sshOpenMode,
        ssh: {
          name: ssh!.name,
          host: ssh!.host,
          user: ssh!.user,
          port: ssh!.port,
          connectionId: ssh!.connectionId,
        },
      };
      tab = {
        id,
        title: o.title || ssh!.name || DEFAULT_TITLE,
        kind: 'session',
        named: !!o.title || !!ssh!.name,
        groupId: o.groupId,
        layout: leaf(term),
      };
    } else if (o.kind === 'history') {
      tab = { id, title: HISTORY_TITLE, kind: 'history', named: true };
    } else if (o.kind === 'settings') {
      tab = { id, title: SETTINGS_TITLE, kind: 'settings', named: true };
    } else {
      const term: TerminalSpec = {
        id: `${id}#0`,
        kind: 'local',
        cwd: o.cwd,
        shellType: o.shellType,
        openMode: defaultOpenModeForShell(o.shellType),
      };
      tab = {
        id,
        title: o.title || (o.shellType ? shellTypeLabel(o.shellType) : DEFAULT_TITLE),
        kind: 'session',
        named: !!o.title,
        groupId: o.groupId,
        layout: leaf(term),
      };
    }

    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    if (isSessionTab(tab)) {
      const ser = serializeSession(tab)!;
      const created = sessionManager.create(id, tab.title, undefined, ser.kind, ser.payload);
      if (tab.groupId) {
        created
          .then(() => sessionSetGroup(id, tab.groupId ?? null))
          .catch((e) => console.warn('[workspace] 新标签归属分组持久化失败:', e));
      }
      // 新建终端不默认入布局（用户拖拽决定停靠位置）
      useTerminalStore.getState().setFocusedPane(firstLeaf(tab.layout).id);
    }
    return id;
  },
  openHistoryTab: () => {
    // 已存在历史标签页则直接激活，避免重复开一堆
    const existing = get().tabs.find((t) => t.kind === 'history');
    if (existing) {
      get().activate(existing.id);
      return;
    }
    get().addTab({ kind: 'history' });
  },
  openSettingsTab: () => {
    const existing = get().tabs.find((t) => t.kind === 'settings');
    if (existing) {
      get().activate(existing.id);
      return;
    }
    get().addTab({ kind: 'settings' });
  },
  closeTab: (id) => {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const closed = tabs[idx]!;
    let next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
      const newId = nextTabId();
      next = [
        {
          id: newId,
          title: DEFAULT_TITLE,
          kind: 'session',
          layout: leaf({ id: `${newId}#0`, kind: 'local' }),
        },
      ];
      sessionManager.create(
        newId,
        DEFAULT_TITLE,
        undefined,
        'session',
        JSON.stringify({ layout: leaf({ id: `${newId}#0`, kind: 'local' }) }),
      );
    }
    set({
      tabs: next,
      activeId: activeId === id ? next[Math.max(0, idx - 1)]!.id : activeId,
      lastClosed: closed,
    });
    // 聚焦若属于被关标签则回落到新的活跃标签
    const fp = useTerminalStore.getState().focusedPaneId;
    if (
      fp === id ||
      (isSessionTab(closed) && layoutLeaves(closed.layout).some((t) => t.id === fp))
    ) {
      const nextTab = next[Math.max(0, idx - 1)]!;
      useTerminalStore
        .getState()
        .setFocusedPane(isSessionTab(nextTab) ? firstLeaf(nextTab.layout).id : nextTab.id);
    }
    // 清理该 tab 各终端的 per-terminal 数据（blocks/chat/terminal 残留）
    if (isSessionTab(closed)) {
      for (const term of layoutLeaves(closed.layout)) {
        useBlockStore.getState().dropTab(term.id);
        useTerminalStore.getState().dropTab(term.id);
        useWorkspaceStore.getState().dropTerminalCwd(term.id);
      }
      useChatStore.getState().dropTab(id);
    }
    // 历史查看页/设置页无后端会话，跳过归档
    if (isSessionTab(closed)) sessionManager.close(id);
    // 关闭标签后若分组变空则直接删除（空分组无意义）
    get().pruneEmptyGroups();
  },
  undoCloseTab: () => {
    const closed = get().lastClosed;
    if (!closed) return;
    set({ lastClosed: null });
    // 恢复真实会话；历史/设置查看页直接重建
    if (closed.kind === 'history') {
      get().addTab({ kind: 'history' });
    } else if (closed.kind === 'settings') {
      get().addTab({ kind: 'settings' });
    } else {
      // kind/payload 已随会话落库，restore 从后端读取重建
      sessionManager.restore(closed.id, closed.title);
    }
    useToastStore.getState().addToast(t('toast.tabRestored'), 'success');
  },
  activate: (id) => {
    const prev = get().activeId;
    set({ activeId: id });
    // 切 tab：重置手动全屏标志（全屏宿主/块终端全屏只属于当前活跃 tab，
    // 保活后旧 tab 仍挂载，标志残留会让隐藏 tab 的 RunningTerm 误进全屏宿主）
    if (id !== prev) useTerminalStore.getState().setAltScreenActive(false);
    // 聚焦回落到该窗口的第一个终端（切窗口后不残留上个窗口的终端聚焦）
    const tab = get().tabs.find((t) => t.id === id);
    useTerminalStore
      .getState()
      .setFocusedPane(tab && isSessionTab(tab) ? firstLeaf(tab.layout).id : id);
  },
  titleFromMessage: (id, text) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.named || !isSessionTab(tab)) return;
    const newTitle = text.slice(0, 14) + (text.length > 14 ? '…' : '');
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, title: newTitle, named: true, titleAuto: true } : t,
      ),
    }));
    sessionManager.rename(id, newTitle);
  },
  titleFromCommand: (id, text) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.named || !isSessionTab(tab)) return;
    const cmd = text.trim();
    if (!cmd) return;
    const newTitle = cmd.slice(0, 24) + (cmd.length > 24 ? '…' : '');
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, title: newTitle, named: true, titleAuto: true } : t,
      ),
    }));
    sessionManager.rename(id, newTitle);
  },
  autoTitle: (id, title) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !isSessionTab(tab) || !title) return;
    // 手动命名（named 且非自动来源）的标题永不被覆盖
    if (tab.named && !tab.titleAuto) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title, named: true, titleAuto: true } : t)),
    }));
    sessionManager.rename(id, title);
  },
  renameTab: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, title: title || DEFAULT_TITLE, named: true, titleAuto: false } : t,
      ),
    }));
    if (title) useToastStore.getState().addToast(t('toast.renamed', { title }), 'success');
    sessionManager.rename(id, title);
  },
  setTerminalCwd: (terminalId, cwd) => {
    set((s) => ({ terminalCwds: { ...s.terminalCwds, [terminalId]: cwd } }));
  },
  dropTerminalCwd: (terminalId) => {
    set((s) => {
      if (!(terminalId in s.terminalCwds)) return s;
      const terminalCwds = { ...s.terminalCwds };
      delete terminalCwds[terminalId];
      return { terminalCwds };
    });
  },
  setWindowLayout: (id, layout) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && isSessionTab(t) ? { ...t, layout } : t)),
    }));
    sessionManager.saveLayout(id, layout);
  },
  splitFocusedDirect: (dir) => {
    const ws = get();
    const tab = ws.tabs.find((t) => t.id === ws.activeId);
    if (!tab || !isSessionTab(tab)) return;
    if (countLeaves(tab.layout) >= 4) {
      useToastStore.getState().addToast('最多 4 个终端', 'info');
      return;
    }
    const termId = getFocusedTerminalId();
    const src = findLeaf(tab.layout, termId);
    if (!src) return;
    const newId = nextTerminalId(tab.id, tab.layout);
    const spec: TerminalSpec = {
      id: newId,
      kind: src.kind,
      shellType: src.shellType,
      ssh: src.ssh ? { ...src.ssh } : undefined,
      cwd: src.cwd,
      // 继承源模式；源未设置（老会话）则回退：SSH 经典、local 按 shell 类型
      openMode:
        src.openMode ?? (src.kind === 'ssh' ? 'classic' : defaultOpenModeForShell(src.shellType)),
    };
    const next = splitLeaf(tab.layout, termId, dir, 'second', spec);
    ws.setWindowLayout(tab.id, next);
    useTerminalStore.getState().setFocusedPane(newId);
  },
  closeTerminal: (terminalId) => {
    const ws = get();
    const tab = ws.tabs.find((t) => t.id === ws.activeId);
    if (!tab || !isSessionTab(tab)) return;
    if (!layoutLeaves(tab.layout).some((t) => t.id === terminalId)) return;
    if (countLeaves(tab.layout) <= 1) {
      ws.closeTab(tab.id);
      return;
    }
    const next = removeLeaf(tab.layout, terminalId);
    if (!next) return;
    ws.setWindowLayout(tab.id, next);
    // 清理被移除终端的 per-terminal 残留（blocks/PTY 记录/cwd）
    useBlockStore.getState().dropTab(terminalId);
    useTerminalStore.getState().dropTab(terminalId);
    ws.dropTerminalCwd(terminalId);
    useTerminalStore.getState().setFocusedPane(firstLeaf(next).id);
  },
  closeFocusedTerminal: () => {
    get().closeTerminal(getFocusedTerminalId());
  },

  // ── 分组 ──

  loadGroups: async () => {
    try {
      const list = await groupsList();
      set({
        // 只加载未归档且含活跃会话的分组（空分组不进入标签面板）
        groups: list
          .filter((g: BackendGroupEntry) => !g.archived && g.session_count > 0)
          .map((g: BackendGroupEntry) => ({ id: g.id, title: g.title, collapsed: g.collapsed })),
      });
    } catch {
      // 后端不可用时保持空分组
    }
  },

  createGroup: async (title) => {
    const name = title.trim();
    if (!name) return '';
    const id = `g${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    try {
      await groupCreate(id, name, Date.now());
    } catch (e) {
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error');
    }
    set((s) => ({ groups: [...s.groups, { id, title: name, collapsed: false }] }));
    return id;
  },

  createGroupForTab: async (tabId, title) => {
    // 默认命名：避开已有分组名（「新分组」「新分组 2」…）
    const base = '新分组';
    const names = new Set(get().groups.map((g) => g.title));
    let name = base;
    let n = 2;
    while (names.has(name)) name = `${base} ${n++}`;
    const id = await get().createGroup((title ?? '').trim() || name);
    if (!id) return '';
    get().moveTab(tabId, id, 0);
    return id;
  },

  renameGroup: (id, title) => {
    const name = title.trim();
    if (!name) return;
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, title: name } : g)) }));
    groupRename(id, name).catch((e) =>
      useToastStore
        .getState()
        .addToast(`重命名分组保存失败：${String((e as Error)?.message ?? e)}`, 'error'),
    );
  },

  toggleGroupCollapse: (id) => {
    const collapsed = !get().groups.find((g) => g.id === id)?.collapsed;
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, collapsed } : g)) }));
    groupSetCollapsed(id, collapsed).catch((e) =>
      useToastStore
        .getState()
        .addToast(`分组折叠状态保存失败：${String((e as Error)?.message ?? e)}`, 'error'),
    );
  },

  deleteGroup: async (id, withSessions) => {
    if (withSessions) {
      await groupDeleteWithSessions(id).catch((e) =>
        useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
      );
    } else {
      await groupDelete(id).catch((e) =>
        useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
      );
    }
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      tabs: s.tabs.map((t) =>
        isSessionTab(t) && t.groupId === id ? { ...t, groupId: undefined } : t,
      ),
    }));
  },

  moveGroup: (id, toIndex) => {
    const groups = [...get().groups];
    const from = groups.findIndex((g) => g.id === id);
    if (from === -1) return;
    const [g] = groups.splice(from, 1);
    groups.splice(Math.max(0, Math.min(toIndex, groups.length)), 0, g!);
    set({ groups });
    groupsReorder(groups.map((x) => x.id)).catch((e) =>
      useToastStore
        .getState()
        .addToast(`分组排序保存失败：${String((e as Error)?.message ?? e)}`, 'error'),
    );
  },

  moveTab: (tabId, targetGroupId, index) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    // 视图标签（历史/设置）不可分组
    if (!tab || !isSessionTab(tab)) return;
    const without = tabs.filter((t) => t.id !== tabId);
    const target = without.filter((t) => isSessionTab(t) && (t.groupId ?? null) === targetGroupId);
    const idx = Math.max(0, Math.min(index, target.length));
    let inserted = false;
    const next: Tab[] = [];
    let seenInTarget = 0;
    for (const t of without) {
      const inTarget = isSessionTab(t) && (t.groupId ?? null) === targetGroupId;
      if (inTarget && seenInTarget === idx) {
        next.push({ ...tab, groupId: targetGroupId ?? undefined });
        inserted = true;
      }
      if (inTarget) seenInTarget += 1;
      next.push(t);
    }
    if (!inserted) next.push({ ...tab, groupId: targetGroupId ?? undefined });
    set({ tabs: next });
    // 持久化：真实会话有后端记录
    sessionSetGroup(tabId, targetGroupId).catch((e) =>
      useToastStore
        .getState()
        .addToast(`移动会话保存失败：${String((e as Error)?.message ?? e)}`, 'error'),
    );
    const ids = next
      .filter((t) => isSessionTab(t) && (t.groupId ?? null) === targetGroupId)
      .map((t) => t.id);
    sessionsReorder(targetGroupId, ids).catch((e) =>
      useToastStore
        .getState()
        .addToast(`会话排序保存失败：${String((e as Error)?.message ?? e)}`, 'error'),
    );
    get().pruneEmptyGroups();
  },

  duplicateTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !isSessionTab(tab)) return;
    const newId = nextTabId();
    // 克隆整棵布局（含多终端分屏），终端 id 全部重排，PTY 会话全新
    const layout = cloneLayout(tab.layout, newId);
    const newTab: Tab = {
      id: newId,
      title: `${tab.title} 副本`,
      kind: 'session',
      named: true,
      groupId: tab.groupId,
      layout,
    };
    set((s) => ({ tabs: [...s.tabs, newTab], activeId: newId }));
    const ser = serializeSession(newTab)!;
    sessionManager.create(newId, newTab.title, undefined, ser.kind, ser.payload);
    if (newTab.groupId)
      sessionSetGroup(newId, newTab.groupId).catch((e) =>
        console.warn('[workspace] 复制标签归属分组持久化失败:', e),
      );
    useTerminalStore.getState().setFocusedPane(firstLeaf(layout).id);
  },

  pruneEmptyGroups: () => {
    const { groups, tabs } = get();
    const emptyIds = groups
      .filter((g) => !tabs.some((t) => isSessionTab(t) && t.groupId === g.id))
      .map((g) => g.id);
    if (emptyIds.length === 0) return;
    set((s) => ({ groups: s.groups.filter((g) => !emptyIds.includes(g.id)) }));
    for (const id of emptyIds)
      groupDelete(id).catch((e) => console.warn('[workspace] 清理空分组失败:', id, e));
  },

  restoreGroup: async (id) => {
    await groupRestore(id).catch((e) =>
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
    );
    await get().loadGroups();
  },

  archiveGroup: async (id) => {
    // 1) 先确保组内会话的 group_id 已落库（此前可能只做了视觉分组）
    const groupTabs = get()
      .tabs.filter(isSessionTab)
      .filter((t) => t.groupId === id);
    for (const t of groupTabs) {
      await sessionSetGroup(t.id, id).catch((e) =>
        useToastStore
          .getState()
          .addToast(`归档前保存分组归属失败：${String((e as Error)?.message ?? e)}`, 'error'),
      );
    }
    // 2) 后端按 group_id 批量归档组内会话 + 标记组为已归档
    await groupArchive(id, Date.now()).catch((e) =>
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
    );
    // 3) 从活跃分组列表移除 + 关闭组内标签（会话已归档，不再作为活跃标签）
    const { tabs, activeId } = get();
    const groupTabIds = groupTabs.map((t) => t.id);
    let next = tabs.filter((t) => !(isSessionTab(t) && t.groupId === id));
    let nextActive = activeId;
    if (groupTabIds.includes(activeId)) {
      nextActive = next[0]?.id ?? '';
    }
    if (next.length === 0) {
      const newId = nextTabId();
      const layout = leaf({ id: `${newId}#0`, kind: 'local' });
      next = [{ id: newId, title: DEFAULT_TITLE, kind: 'session' as const, layout }];
      sessionManager.create(newId, DEFAULT_TITLE, undefined, 'session', JSON.stringify({ layout }));
      nextActive = newId;
    }
    set((s) => ({
      tabs: next,
      activeId: nextActive,
      groups: s.groups.filter((g) => g.id !== id),
    }));
    for (const t of groupTabs) {
      for (const term of layoutLeaves(t.layout)) {
        useBlockStore.getState().dropTab(term.id);
        useTerminalStore.getState().dropTab(term.id);
        useWorkspaceStore.getState().dropTerminalCwd(term.id);
      }
      useChatStore.getState().dropTab(t.id);
    }
    useToastStore.getState().addToast('分组已归档到会话历史', 'success');
  },
}));

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import { t } from '../i18n';
import * as sessionManager from '../lib/sessionManager';
import {
  groupsList, groupCreate, groupRename, groupSetCollapsed, groupDelete,
  groupDeleteWithSessions, groupsReorder, sessionSetGroup, sessionsReorder,
  groupRestore, groupArchive,
} from '../api/group';
import type { BackendGroupEntry } from '../search/types';
import { useBlockStore } from './blocks';
import { useChatStore } from './chat';
import { useTerminalStore, getFocusedPaneId } from './terminal';
import { useTerminalLayoutStore } from './terminalLayout';
import type { ShellType } from '../lib/shells';
import { shellTypeLabel } from '../lib/shells';

export type TabKind = 'local' | 'ssh' | 'history' | 'settings';

/** SSH 会话目标（kind=ssh 时的专属字段） */
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
}

/** 真实会话标签（本地/SSH）：可落库、可分组、可进历史 */
interface SessionTabBase extends TabBase {
  groupId?: string;
  cwd?: string;
}

/**
 * 标签判别联合：
 *  - local / ssh 是真实会话（持久化、可分组、进历史）
 *  - history / settings 是临时视图（单例复用，不落库、不可分组）
 */
export type Tab =
  | (SessionTabBase & { kind: 'local'; shellType?: ShellType })
  | (SessionTabBase & { kind: 'ssh'; ssh: SshTabTarget })
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
  /** 默认 'local' */
  kind?: TabKind;
  shellType?: ShellType;
  /** SSH 连接目标（kind='ssh' 时） */
  ssh?: SshTabTarget;
  /** 归属分组 id */
  groupId?: string;
}

/** 是否为真实会话（可落库、可分组） */
export function isSessionTab(tab: Tab): tab is Extract<Tab, { kind: 'local' | 'ssh' }> {
  return tab.kind === 'local' || tab.kind === 'ssh';
}

/** 聚焦 pane 的当前工作目录：主 pane 读 tab.cwd，副 pane 读 paneCwds（回退到 tab.cwd）。 */
export function getFocusedCwd(): string | undefined {
  const paneId = getFocusedPaneId();
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === paneId);
  if (tab && isSessionTab(tab)) return tab.cwd;
  const activeTab = ws.tabs.find((t) => t.id === ws.activeId);
  const base = activeTab && isSessionTab(activeTab) ? activeTab.cwd : undefined;
  return ws.paneCwds[paneId] ?? base;
}

/** 把真实会话标签序列化成后端 { kind, payload }；视图标签返回 null。 */
export function serializeSession(tab: Tab): { kind: 'local' | 'ssh'; payload: string } | null {
  if (tab.kind === 'ssh') {
    return {
      kind: 'ssh',
      payload: JSON.stringify({
        ssh: {
          name: tab.ssh.name,
          host: tab.ssh.host,
          user: tab.ssh.user ?? null,
          port: tab.ssh.port ?? null,
          connectionId: tab.ssh.connectionId ?? null,
        },
      }),
    };
  }
  if (tab.kind === 'local') {
    return { kind: 'local', payload: JSON.stringify({ shellType: tab.shellType ?? null }) };
  }
  return null;
}

// 标签 id 跨重启唯一（时间戳前缀 + 自增），避免重启后与历史会话 id 碰撞
const ID_PREFIX = Date.now().toString(36);
let counter = 0;
const nextTabId = () => `t${ID_PREFIX}-${counter++}`;
const initialTabId = nextTabId();
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
  renameTab: (id: string, title: string) => void;
  undoCloseTab: () => void;
  /** 更新标签的当前工作目录（从 shell OSC 7 检测） */
  setTabCwd: (id: string, cwd: string) => void;
  /** 分屏副 pane 的当前工作目录（keyed by paneId，不落库 —— 副 pane 生命周期随分屏） */
  paneCwds: Record<string, string>;
  setPaneCwd: (paneId: string, cwd: string) => void;
  /** 解除分屏时删除副 pane 的 cwd 残留 */
  dropPaneCwd: (paneId: string) => void;

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
  /** 清理没有任何活跃标签的空分组（空分组无意义，直接删除） */
  pruneEmptyGroups: () => void;
  /** 恢复分组内全部历史会话为标签页 */
  restoreGroup: (id: string) => Promise<void>;
  /** 归档分组：组内活跃标签全部关闭并移入会话历史，组本身保留 */
  archiveGroup: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [{ id: initialTabId, title: DEFAULT_TITLE, kind: 'local' }],
  activeId: initialTabId,
  lastClosed: null,
  groups: [],
  paneCwds: {},
  addTab: (opts) => {
    const o = opts ?? {};
    const id = nextTabId();
    const kind: TabKind = o.kind ?? (o.ssh ? 'ssh' : 'local');

    let tab: Tab;
    if (kind === 'ssh') {
      const ssh = o.ssh ?? { name: DEFAULT_TITLE, host: '' };
      tab = {
        id,
        title: o.title || ssh.name || DEFAULT_TITLE,
        kind: 'ssh',
        named: !!o.title || !!ssh.name,
        groupId: o.groupId,
        cwd: o.cwd,
        ssh: { name: ssh.name, host: ssh.host, user: ssh.user, port: ssh.port, connectionId: ssh.connectionId },
      };
    } else if (kind === 'local') {
      // 惯用命名范式：shell=类型名；否则「终端」占位，等首条命令改名
      tab = {
        id,
        title: o.title || (o.shellType ? shellTypeLabel(o.shellType) : DEFAULT_TITLE),
        kind: 'local',
        named: !!o.title,
        groupId: o.groupId,
        cwd: o.cwd,
        shellType: o.shellType,
      };
    } else if (kind === 'history') {
      tab = { id, title: HISTORY_TITLE, kind: 'history', named: true };
    } else {
      tab = { id, title: SETTINGS_TITLE, kind: 'settings', named: true };
    }

    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    // 历史/设置视图不是真实会话，不落库
    if (isSessionTab(tab)) {
      const ser = serializeSession(tab)!;
      const created = sessionManager.create(id, tab.title, tab.cwd, ser.kind, ser.payload);
      // 等会话行落库后再设分组，避免 UPDATE 早于 INSERT 导致 group_id 丢失
      if (tab.groupId) {
        created.then(() => sessionSetGroup(id, tab.groupId ?? null)).catch(() => {});
      }
      // 新会话自动停靠到第一个空槽位（终端区域最多 4 个）
      const slot = useTerminalLayoutStore.getState().firstFreeSlot();
      if (slot !== null) useTerminalLayoutStore.getState().dockTab(id, slot);
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
      next = [{ id: newId, title: DEFAULT_TITLE, kind: 'local' }];
      sessionManager.create(newId, DEFAULT_TITLE, undefined, 'local', '{}');
    }
    set({
      tabs: next,
      activeId: activeId === id ? next[Math.max(0, idx - 1)]!.id : activeId,
      lastClosed: closed,
    });
    // 聚焦若属于被关标签则回落到新的活跃标签
    const fp = useTerminalStore.getState().focusedPaneId;
    if (fp === id) {
      useTerminalStore.getState().setFocusedPane(activeId === id ? next[Math.max(0, idx - 1)]!.id : activeId);
    }
    // 清理该 tab 在各 store 的 per-tab 数据，否则 blocks/chat/terminal 残留累积
    useBlockStore.getState().dropTab(id);
    useChatStore.getState().dropTab(id);
    useTerminalStore.getState().dropTab(id);
    useTerminalLayoutStore.getState().undockTab(id);
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
    set({ activeId: id });
    // focusedPaneId 是全局的，切标签后残留上个标签的 pane；统一回落到该标签主 pane
    useTerminalStore.getState().setFocusedPane(id);
    // 会话标签若未停靠且有空槽，自动停靠，避免「激活但不可见」
    const tab = get().tabs.find((t) => t.id === id);
    if (tab && isSessionTab(tab) && !useTerminalLayoutStore.getState().isDocked(id)) {
      const slot = useTerminalLayoutStore.getState().firstFreeSlot();
      if (slot !== null) useTerminalLayoutStore.getState().dockTab(id, slot);
    }
  },
  titleFromMessage: (id, text) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.named || !isSessionTab(tab)) return;
    const newTitle = text.slice(0, 14) + (text.length > 14 ? '…' : '');
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: newTitle, named: true } : t)),
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
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: newTitle, named: true } : t)),
    }));
    sessionManager.rename(id, newTitle);
  },
  renameTab: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: title || DEFAULT_TITLE, named: true } : t)),
    }));
    if (title) useToastStore.getState().addToast(t('toast.renamed', { title }), 'success');
    sessionManager.rename(id, title);
  },
  setTabCwd: (id, cwd) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && isSessionTab(t) ? { ...t, cwd } : t)),
    }));
  },
  setPaneCwd: (paneId, cwd) => {
    set((s) => ({ paneCwds: { ...s.paneCwds, [paneId]: cwd } }));
  },
  dropPaneCwd: (paneId) => {
    set((s) => {
      if (!(paneId in s.paneCwds)) return s;
      const paneCwds = { ...s.paneCwds };
      delete paneCwds[paneId];
      return { paneCwds };
    });
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
    groupRename(id, name).catch(() => {});
  },

  toggleGroupCollapse: (id) => {
    const collapsed = !get().groups.find((g) => g.id === id)?.collapsed;
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, collapsed } : g)) }));
    groupSetCollapsed(id, collapsed).catch(() => {});
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
      tabs: s.tabs.map((t) => (isSessionTab(t) && t.groupId === id ? { ...t, groupId: undefined } : t)),
    }));
  },

  moveGroup: (id, toIndex) => {
    const groups = [...get().groups];
    const from = groups.findIndex((g) => g.id === id);
    if (from === -1) return;
    const [g] = groups.splice(from, 1);
    groups.splice(Math.max(0, Math.min(toIndex, groups.length)), 0, g!);
    set({ groups });
    groupsReorder(groups.map((x) => x.id)).catch(() => {});
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
    sessionSetGroup(tabId, targetGroupId).catch(() => {});
    const ids = next.filter((t) => isSessionTab(t) && (t.groupId ?? null) === targetGroupId).map((t) => t.id);
    sessionsReorder(targetGroupId, ids).catch(() => {});
    get().pruneEmptyGroups();
  },

  pruneEmptyGroups: () => {
    const { groups, tabs } = get();
    const emptyIds = groups
      .filter((g) => !tabs.some((t) => isSessionTab(t) && t.groupId === g.id))
      .map((g) => g.id);
    if (emptyIds.length === 0) return;
    set((s) => ({ groups: s.groups.filter((g) => !emptyIds.includes(g.id)) }));
    for (const id of emptyIds) groupDelete(id).catch(() => {});
  },

  restoreGroup: async (id) => {
    await groupRestore(id).catch((e) =>
      useToastStore.getState().addToast(String((e as Error)?.message ?? e), 'error'),
    );
    await get().loadGroups();
  },

  archiveGroup: async (id) => {
    // 1) 先确保组内会话的 group_id 已落库（此前可能只做了视觉分组）
    const groupTabs = get().tabs.filter((t) => isSessionTab(t) && t.groupId === id);
    for (const t of groupTabs) {
      await sessionSetGroup(t.id, id).catch(() => {});
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
      next = [{ id: newId, title: DEFAULT_TITLE, kind: 'local' as const }];
      sessionManager.create(newId, DEFAULT_TITLE, undefined, 'local', '{}');
      nextActive = newId;
    }
    set((s) => ({
      tabs: next,
      activeId: nextActive,
      groups: s.groups.filter((g) => g.id !== id),
    }));
    for (const tid of groupTabIds) {
      useBlockStore.getState().dropTab(tid);
      useChatStore.getState().dropTab(tid);
      useTerminalStore.getState().dropTab(tid);
    }
    useToastStore.getState().addToast('分组已归档到会话历史', 'success');
  },
}));

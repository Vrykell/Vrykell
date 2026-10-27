import { useTerminalDefaults } from '@config/terminalDefaults';
import { useWorkbenchStore } from './workbench';
import { reportWorkbenchFailure } from './workbenchFeedback';
import { detachContainerPane, putContainer, type WorkspaceGroup } from '../model/workbench';
import { terminalResourceLayout, terminalWorkspaceLayout } from '../model/workspaceResources';
import { useShellProfiles } from '@config/shellProfiles';
import { create } from 'zustand';
import { useUiStore } from './ui';
import { useWorkspaceNavigation, workspaceAreaForKind } from './navigation';
import { gitComparisonKey, type GitSelection, type GitComparison } from '@core/git';
import { editorFileKey, interceptEditorClose, type EditorFile } from '@core/editor';
import type { SshOptions } from '@core/ssh';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { interceptHarnessClose } from '@core/harness';
import * as sessionManager from '@features/workspace/services/sessionManager';
import {
  groupsList, sessionSetGroup,
} from '@platform/api/group';
import type { BackendGroupEntry } from '@platform/api/types';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useInputStore } from '@features/terminal/stores/input';
import { useChatStore } from '@features/chat/stores/chat';
import { useAgentSettings } from '@features/agent/stores/agentSettings';
import { defaultOpenModeForShell } from '@features/agent/stores/agentSettings';
import { useTerminalStore, getFocusedTerminalId } from '@features/terminal/stores/terminal';
import type { ShellType } from '@platform/shells';
import { shellTypeLabel } from '@platform/shells';
import {
  leaf, leaves as layoutLeaves, firstLeaf, findLeaf, splitLeaf, replaceLeaf, removeLeaf, countLeaves, mapTerminals,
  type WindowLayout, type TerminalSpec, type SplitDir,
} from '@features/workspace/model/windowLayout';
import {
  COMMAND_TITLE_LEN, MESSAGE_TITLE_LEN, canApplyTitle, normalizeCommandForTitle, truncateTitle,
  type TitleSource,
} from '@features/workspace/model/sessionTitle';

export type { TitleSource };

export type TabKind = 'session' | 'history' | 'ai-history' | 'git-diff' | 'editor' | 'usage' | 'harness'
  | 'start' | 'start-code' | 'start-ai';

/** SSH 会话目标（终端类型=ssh 时的专属字段） */
export interface SshTabTarget extends SshOptions {
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
  /** Title source; decides which later assignment may overwrite it (absent = default title). */
  titleSource?: TitleSource;
}

/** Native resource owners and singleton pages; the workbench owns every visible tab. */
export type Tab =
  | (TabBase & { kind: 'session'; groupId?: string; layout: WindowLayout })
  | (TabBase & { kind: 'history' })
  | (TabBase & { kind: 'ai-history' })
  | (TabBase & { kind: 'git-diff'; selection: GitSelection; comparisons?: GitComparison[] })
  | (TabBase & { kind: 'editor'; files: EditorFile[]; selected: EditorFile })
  | (TabBase & { kind: 'usage' })
  | (TabBase & { kind: 'harness' })
  | (TabBase & { kind: 'start' })
  | (TabBase & { kind: 'start-code' })
  | (TabBase & { kind: 'start-ai' });

/** Native terminal groups omit the scope because their owner is fixed. */
export type TabGroup = Omit<WorkspaceGroup, 'scope'>;

export interface AddTabOptions {
  cwd?: string;
  useProfileDirectory?: boolean;
  title?: string;
  /** Defaults to local; history and usage kinds create workspace pages. */
  kind?: 'local' | 'ssh' | 'history' | 'ai-history' | 'usage' | 'harness' | 'start' | 'start-code' | 'start-ai';
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

/** Placeholder pages keep a workspace strip from ever going empty. */
export function isStartTab(tab: Tab): tab is Extract<Tab, { kind: 'start' | 'start-code' | 'start-ai' }> {
  return tab.kind === 'start' || tab.kind === 'start-code' || tab.kind === 'start-ai';
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

/** Clone resource identities through the shared tree mapper. */
function cloneLayout(layout: WindowLayout, newWindowId: string): WindowLayout {
  let n = 0;
  return mapTerminals(layout, terminal => ({ ...terminal, id: `${newWindowId}#${n++}` }));
}

// 标签 id 跨重启唯一（时间戳前缀 + 自增），避免重启后与历史会话 id 碰撞
const ID_PREFIX = Date.now().toString(36);
let counter = 0;
const nextTabId = () => `t${ID_PREFIX}-${counter++}`;
const defaultTitle = () => t('Terminal');
const HISTORY_TITLE = t('Session history');
const AI_HISTORY_TITLE = t('AI conversation history');
const USAGE_TITLE = t('Usage statistics');
const START_TITLE = t('Start');

interface WorkspaceState {
  tabs: Tab[];
  activeId: string;
  /** 最近关闭的标签（撤销关闭用，不参与 UI 渲染） */
  lastClosed: Tab | null;
  addTab: (opts?: AddTabOptions) => string;
  /** Open the singleton session history page. */
  openHistoryTab: () => void;
  /** Open the singleton AI conversation history page. */
  openAiHistoryTab: () => void;
  openUsageTab: () => void;
  /** Open (or focus) the session page of a configured harness. */
  openHarnessTab: (name?: string, cwd?: string) => void;
  lastLocalPaneId: string | null;
  /** 新建/复用设置标签页 */
  openSettings: () => void;
  openGitDiff: (selection: GitSelection) => string;
  openEditorFile: (file: EditorFile) => string;
  closeEditorFile: (file: EditorFile, force?: boolean) => void;
  replaceEditorFile: (file: EditorFile, target: EditorFile) => void;
  moveEditorFile: (key: string, over: string, after: boolean) => void;
  moveGitComparison: (id: string, over: string, after: boolean) => void;
  configureEditorTabs: () => void;
  activateGitComparison: (id: string) => void;
  closeGitComparison: (id: string) => void;
  configureGitDiffTabs: () => void;
  closeTab: (id: string, force?: boolean) => void;
  activate: (id: string) => void;
  /** Every workspace that would have an empty tab strip gets its placeholder start page. */
  ensureStartPages: () => void;
  /** Name the tab from the first user message (fills the default title or upgrades a command title). */
  titleFromMessage: (id: string, text: string) => void;
  /** Name the tab from the first meaningful command (a shared naming convention). */
  titleFromCommand: (id: string, text: string) => void;
  /** AI title: refreshes any generated title; a manual name needs `allowManual`. */
  autoTitle: (id: string, title: string, options?: { allowManual?: boolean }) => void;
  renameTab: (id: string, title: string) => void;
  undoCloseTab: () => void;
  /** 更新某终端的当前工作目录（从 shell OSC 7 检测），keyed by 终端 id */
  setTerminalCwd: (terminalId: string, cwd: string) => void;
  /** 终端运行时 cwd（keyed by 终端 id，不落库） */
  terminalCwds: Record<string, string>;
  /** 移除终端时清理其 cwd 残留 */
  dropTerminalCwd: (terminalId: string) => void;
  /** Live title a running program set via OSC 0/2, keyed by terminal id (never persisted). */
  programTitles: Record<string, string>;
  /** Record (or clear, with an empty value) a terminal's program-set title. */
  setProgramTitle: (terminalId: string, title: string) => void;
  /** 更新窗口的终端布局（分裂/移除/替换/调比例），并持久化 */
  setWindowLayout: (id: string, layout: WindowLayout) => void;
  /** 把某个终端窗格移出当前会话标签，放成一个新的会话标签 */
  detachTerminalPane: (paneId: string) => void;
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
  /** 复制会话：以相同终端配置（类型/SSH 目标/cwd/布局）克隆一个新标签页 */
  duplicateTab: (tabId: string) => void;
  /** Hide groups without active tabs while retaining their historical membership. */
  pruneEmptyGroups: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // 初始无标签：默认终端由 App 启动逻辑创建（优先恢复上次会话，无恢复才创建默认）
  tabs: [],
  activeId: '',
  lastClosed: null,
  groups: [],
  terminalCwds: {},
  programTitles: {},
  lastLocalPaneId: null,
  addTab: (opts) => {
    const o = opts ?? {};
    const current = get().tabs.find(tab => tab.id === get().activeId);
    const focused = current && isSessionTab(current) ? findLeaf(current.layout, useTerminalStore.getState().focusedPaneId ?? '') ?? firstLeaf(current.layout) : null;
    if (focused?.kind === 'local') set({ lastLocalPaneId: focused.id });
    if (o.kind === 'history' || o.kind === 'ai-history' || o.kind === 'usage' || o.kind === 'harness'
      || o.kind === 'start' || o.kind === 'start-code' || o.kind === 'start-ai') {
      const existing = get().tabs.find(tab => tab.kind === o.kind);
      if (existing) {
        get().activate(existing.id);
        return existing.id;
      }
    }
    const id = nextTabId();
    const isSsh = o.kind === 'ssh' || !!o.ssh;
    const ssh = isSsh ? (o.ssh ?? { name: defaultTitle(), host: '' }) : null;

    let tab: Tab;
    if (isSsh) {
      const term: TerminalSpec = {
        id: `${id}#0`,
        kind: 'ssh',
        cwd: o.cwd,
        openMode: useAgentSettings.getState().global.sshOpenMode,
        ssh: { ...ssh! },
      };
      tab = {
        id,
        title: o.title || ssh!.name || defaultTitle(),
        kind: 'session',
        titleSource: o.title || ssh!.name ? 'manual' : undefined,
        groupId: o.groupId,
        layout: leaf(term),
      };
    } else if (o.kind === 'history') {
      tab = { id, title: HISTORY_TITLE, kind: 'history', titleSource: 'manual' };
    } else if (o.kind === 'ai-history') {
      tab = { id, title: AI_HISTORY_TITLE, kind: 'ai-history', titleSource: 'manual' };
    } else if (o.kind === 'usage') {
      tab = { id, title: USAGE_TITLE, kind: 'usage', titleSource: 'manual' };
    } else if (o.kind === 'harness') {
      tab = { id, title: t('AI workspace'), kind: 'harness', titleSource: 'manual' };
    } else if (o.kind === 'start' || o.kind === 'start-code' || o.kind === 'start-ai') {
      tab = { id, title: START_TITLE, kind: o.kind, titleSource: 'manual' };
    } else {
      const preference = useTerminalDefaults.getState().shell;
      const shellType = o.shellType ?? (preference === 'system' ? undefined : preference);
      const profile = shellType ? useShellProfiles.getState().profiles[shellType as ShellType] : undefined;
      const term: TerminalSpec = {
        id: `${id}#0`, kind: 'local', cwd: o.cwd ?? (o.useProfileDirectory === false ? undefined : profile?.cwd || undefined), shellType,
        useProfileDirectory: o.useProfileDirectory,
        openMode: defaultOpenModeForShell(shellType),
      };
      tab = {
        id,
        title: o.title || profile?.tabTitle || profile?.name || (shellType ? shellTypeLabel(shellType) : defaultTitle()),
        kind: 'session',
        titleSource: o.title || profile?.tabTitle ? 'manual' : undefined,
        groupId: o.groupId,
        layout: leaf(term),
      };
    }

    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    if (isSessionTab(tab)) {
      const ser = serializeSession(tab)!;
      const created = sessionManager.create(id, tab.title, undefined, ser.kind, ser.payload);
      if (tab.groupId) {
        created.then(() => sessionSetGroup(id, tab.groupId ?? null)).catch((e) =>
          console.warn('[workspace] 新标签归属分组持久化失败:', e),
        );
      }
      // 新建终端不默认入布局（用户拖拽决定停靠位置）
      useTerminalStore.getState().setFocusedPane(firstLeaf(tab.layout).id);
    }
    // A real tab replaces the area's placeholder start page.
    get().ensureStartPages();
    return id;
  },
  openHistoryTab: () => {
    const navigation = useWorkspaceNavigation.getState();
    if (navigation.area === 'unified') { navigation.selectHistory('terminal'); return; }
    useWorkspaceNavigation.setState({ historyDestination: 'native' });
    const existing = get().tabs.find((t) => t.kind === 'history');
    get().activate(existing ? existing.id : get().addTab({ kind: 'history' }));
  },
  openAiHistoryTab: () => {
    const navigation = useWorkspaceNavigation.getState();
    if (navigation.area === 'unified') { navigation.selectHistory('conversation'); return; }
    useWorkspaceNavigation.setState({ historyDestination: 'native' });
    useWorkspaceNavigation.getState().setAiPlacement('main');
    const existing = get().tabs.find((t) => t.kind === 'ai-history');
    get().activate(existing ? existing.id : get().addTab({ kind: 'ai-history' }));
  },
  openUsageTab: () => {
    useUiStore.getState().setSettingsOpen(false);
    useWorkspaceNavigation.getState().setAiPlacement('main');
    const existing = get().tabs.find((t) => t.kind === 'usage');
    get().activate(existing ? existing.id : get().addTab({ kind: 'usage' }));
  },
  openHarnessTab: (name, cwd) => {
    if (useWorkspaceNavigation.getState().area !== 'unified') useWorkspaceNavigation.getState().setAiPlacement('main');
    // Capture the focused local context before switching to the singleton page.
    const state = get();
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    const sessionLeaves = state.tabs.flatMap(tab => isSessionTab(tab) ? layoutLeaves(tab.layout) : []).filter(pane => pane.kind === 'local');
    const focused = active && isSessionTab(active) ? findLeaf(active.layout, useTerminalStore.getState().focusedPaneId ?? '') ?? firstLeaf(active.layout) : null;
    const spec = focused?.kind === 'local' ? focused : sessionLeaves.find(pane => pane.id === state.lastLocalPaneId);
    const directory = cwd ?? (spec ? state.terminalCwds[spec.id] ?? spec.cwd : undefined);
    if (name) useAiWorkspace.getState().select(`acp:${useHarnessWorkspace.getState().connect(name, directory)}`);
    useUiStore.getState().setSettingsOpen(false);
    if (useWorkspaceNavigation.getState().area !== 'unified') useWorkspaceNavigation.getState().selectArea('ai');
    get().addTab({ kind: 'harness' });
  },
  openEditorFile: file => {
    get().configureEditorTabs();
    const existing = get().tabs.find(tab => tab.kind === 'editor');
    if (existing?.kind === 'editor') {
      const selected = existing.files.find(item => editorFileKey(item) === editorFileKey(file)) ?? file;
      set(state => ({ tabs: state.tabs.map(tab => tab.id === existing.id ? { ...existing, files: existing.files.includes(selected) ? existing.files : [...existing.files, selected], selected } : tab) }));
      get().activate(existing.id); return existing.id;
    }
    const id = nextTabId();
    set(state => ({ tabs: [...state.tabs, { id, kind: 'editor', title: t('File editor'), files: [file], selected: file }] }));
    get().activate(id); return id;
  },
  replaceEditorFile: (file, target) => {
    const key = editorFileKey(file);
    set(state => ({ tabs: state.tabs.map(tab => tab.kind === 'editor' ? { ...tab,
      files: tab.files.map(item => editorFileKey(item) === key ? target : item),
      selected: editorFileKey(tab.selected) === key ? target : tab.selected,
    } : tab) }));
  },
  closeEditorFile: (file, force = false) => {
    if (!force && interceptEditorClose([file], () => get().closeEditorFile(file, true))) return;
    const key = editorFileKey(file);
    const page = get().tabs.find(tab => tab.kind === 'editor' && tab.files.some(item => editorFileKey(item) === key));
    if (page?.kind !== 'editor') return;
    const index = page.files.findIndex(item => editorFileKey(item) === key);
    const files = page.files.filter(item => editorFileKey(item) !== key);
    if (!files.length) { get().closeTab(page.id, true); return; }
    set(state => ({ tabs: state.tabs.map(tab => tab.id === page.id ? { ...page, files, selected: editorFileKey(page.selected) === key ? files[Math.min(index, files.length - 1)]! : page.selected } : tab),
      lastClosed: { ...page, files: [file], selected: file } }));
  },
  moveEditorFile: (key, over, after) => {
    if (key === over) return;
    set(state => ({ tabs: state.tabs.map(tab => {
      if (tab.kind !== 'editor') return tab;
      const item = tab.files.find(file => editorFileKey(file) === key);
      if (!item || !tab.files.some(file => editorFileKey(file) === over)) return tab;
      const files = tab.files.filter(file => editorFileKey(file) !== key);
      files.splice(files.findIndex(file => editorFileKey(file) === over) + (after ? 1 : 0), 0, item);
      return { ...tab, files };
    }) }));
  },
  moveGitComparison: (id, over, after) => {
    if (id === over) return;
    set(state => ({ tabs: state.tabs.map(tab => {
      if (tab.kind !== 'git-diff' || !tab.comparisons) return tab;
      const item = tab.comparisons.find(comparison => comparison.id === id);
      if (!item || !tab.comparisons.some(comparison => comparison.id === over)) return tab;
      const comparisons = tab.comparisons.filter(comparison => comparison.id !== id);
      comparisons.splice(comparisons.findIndex(comparison => comparison.id === over) + (after ? 1 : 0), 0, item);
      return { ...tab, comparisons };
    }) }));
  },
  configureEditorTabs: () => {
    const state = get(); const pages = state.tabs.filter(tab => tab.kind === 'editor');
    if (!pages.length || (pages.length === 1 && pages[0]!.title === t('File editor'))) return;
    const selected = pages.find(tab => tab.id === state.activeId)?.selected ?? pages[0]!.selected;
    const files = [...new Map(pages.flatMap(tab => tab.files).map(file => [editorFileKey(file), file])).values()];
    const page = { ...pages[0]!, files, selected, title: t('File editor') };
    const owners = new Set(pages.map(tab => tab.id));
    const retarget = (selection: GitSelection): GitSelection => selection.paneId && owners.has(selection.paneId)
      ? { ...selection, paneId: page.id } : selection;
    const retargetReview = (tab: Tab): Tab => tab.kind === 'git-diff' ? { ...tab, selection: retarget(tab.selection),
      comparisons: tab.comparisons?.map(item => {
        const selection = retarget(item.selection);
        return selection === item.selection ? item : { ...item, selection };
      }) } : tab;
    set({ tabs: state.tabs.flatMap<Tab>(tab => tab.id === page.id ? [page] : tab.kind === 'editor' ? [] : [retargetReview(tab)]),
      activeId: pages.some(tab => tab.id === state.activeId) ? page.id : state.activeId,
      lastClosed: state.lastClosed ? retargetReview(state.lastClosed) : null });
  },
  openGitDiff: (selection) => {
    get().configureGitDiffTabs();
    const singleton = get().tabs.find(tab => tab.kind === 'git-diff' && tab.comparisons);
    if (singleton?.kind === 'git-diff' && singleton.comparisons) {
      const existing = singleton.comparisons.find(item => gitComparisonKey(item.selection) === gitComparisonKey(selection));
      const comparisons = existing ? singleton.comparisons : [...singleton.comparisons, { id: nextTabId(), selection }];
      set(state => ({ tabs: state.tabs.map(tab => tab.id === singleton.id ? { ...singleton, selection: existing?.selection ?? selection, comparisons } : tab) }));
      get().activate(singleton.id);
      return singleton.id;
    }
    const id = nextTabId();
    set(state => ({ tabs: [...state.tabs, { id, title: t('File comparisons'), kind: 'git-diff', selection,
      comparisons: [{ id, selection }] }], activeId: id }));
    return id;
  },
  activateGitComparison: id => {
    const page = get().tabs.find(tab => tab.kind === 'git-diff' && tab.comparisons?.some(item => item.id === id));
    if (page?.kind !== 'git-diff') { get().activate(id); return; }
    const selection = page.comparisons!.find(item => item.id === id)!.selection;
    set(state => ({ tabs: state.tabs.map(tab => tab.id === page.id ? { ...page, selection } : tab) }));
    get().activate(page.id);
  },
  closeGitComparison: id => {
    const page = get().tabs.find(tab => tab.kind === 'git-diff' && tab.comparisons?.some(item => item.id === id));
    if (page?.kind !== 'git-diff' || !page.comparisons) { get().closeTab(id); return; }
    const index = page.comparisons.findIndex(item => item.id === id);
    const closed = page.comparisons[index]!;
    const comparisons = page.comparisons.filter(item => item.id !== id);
    if (!comparisons.length) { get().closeTab(page.id); return; }
    const selection = gitComparisonKey(page.selection) === gitComparisonKey(closed.selection)
      ? comparisons[Math.min(index, comparisons.length - 1)]!.selection : page.selection;
    set(state => ({ tabs: state.tabs.map(tab => tab.id === page.id ? { ...page, comparisons, selection } : tab),
      lastClosed: { ...page, id: closed.id, selection: closed.selection, comparisons: undefined } }));
  },
  configureGitDiffTabs: () => {
    const state = get();
    const pages = state.tabs.filter(tab => tab.kind === 'git-diff');
    if (!pages.length || (pages.length === 1 && !!pages[0]!.comparisons)) return;
    const comparisons = [...new Map(pages.flatMap(tab => tab.comparisons ?? [{ id: tab.id, selection: tab.selection }])
      .map(item => [gitComparisonKey(item.selection), item])).values()];
    const selectedPage = pages.find(tab => tab.id === state.activeId) ?? pages[0]!;
    const selected = comparisons.find(item => gitComparisonKey(item.selection) === gitComparisonKey(selectedPage.selection))!;
    const replacements: Tab[] = [{ ...pages[0]!, title: t('File comparisons'), comparisons, selection: selected.selection }];
    const firstId = pages[0]!.id;
    set({ tabs: state.tabs.flatMap(tab => tab.id === firstId ? replacements : tab.kind === 'git-diff' ? [] : [tab]),
      activeId: pages.some(tab => tab.id === state.activeId) ? firstId : state.activeId });
  },
  openSettings: () => {
    useUiStore.getState().setSettingsOpen(true);
  },
  closeTab: (id, force = false) => {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const closed = tabs[idx]!;
    if (closed.kind === 'harness' && !force && interceptHarnessClose(useHarnessWorkspace.getState().connections.map(item => item.id), () => get().closeTab(id, true))) {
      get().activate(id);
      return;
    }
    if (closed.kind === 'editor' && !force && interceptEditorClose(closed.files, () => get().closeTab(id, true))) return;
    const next = tabs.filter((t) => t.id !== id);
    const neighbor = [...tabs.slice(0, idx).reverse(), ...tabs.slice(idx + 1)].find(tab => workspaceAreaForKind(tab.kind) === workspaceAreaForKind(closed.kind));
    const nextActiveId = activeId === id ? neighbor?.id ?? '' : activeId;
    // System pages are singletons that never enter the reopen history.
    const reopenable = closed.kind !== 'history' && closed.kind !== 'ai-history' && closed.kind !== 'usage' && !isStartTab(closed);
    set({
      tabs: next,
      activeId: nextActiveId,
      lastClosed: reopenable ? closed : null,
    });
    // 聚焦若属于被关标签则回落到新的活跃标签
    const fp = useTerminalStore.getState().focusedPaneId;
    if (fp === id || (isSessionTab(closed) && layoutLeaves(closed.layout).some((t) => t.id === fp))) {
      const nextTab = next.find((tab) => tab.id === get().activeId);
      useTerminalStore.getState().setFocusedPane(nextTab ? (isSessionTab(nextTab) ? firstLeaf(nextTab.layout).id : nextTab.id) : null);
    }
    // 清理该 tab 各终端的 per-terminal 数据（blocks/chat/terminal 残留）
    if (isSessionTab(closed)) {
      for (const term of layoutLeaves(closed.layout)) {
        useBlockStore.getState().dropTab(term.id);
        useTerminalStore.getState().dropTab(term.id);
        useInputStore.getState().dropPane(term.id);
        useWorkspaceStore.getState().dropTerminalCwd(term.id);
        useWorkspaceStore.getState().setProgramTitle(term.id, '');
      }
      useChatStore.getState().dropTab(id);
    }
    // Workspace pages have no backend session to archive.
    if (isSessionTab(closed)) {
      const retry = () => { void sessionManager.close(id).catch(error => reportWorkbenchFailure(error, retry)); };
      retry();
    }
    if (closed.kind === 'harness') useHarnessWorkspace.getState().close(useHarnessWorkspace.getState().connections.map(item => item.id));
    // Historical members still belong to their original group after its last tab closes.
    get().ensureStartPages();
    get().pruneEmptyGroups();
  },
  undoCloseTab: () => {
    if (useWorkbenchStore.getState().lastClosed) {
      void import('../services/workbench').then(module => module.undoCloseContainer()).catch(error => {
        useToastStore.getState().addToast(t('Could not restore workspace: {{error}}', { error: String(error) }), 'error');
      });
      return;
    }
    const closed = get().lastClosed;
    if (!closed) return;
    set({ lastClosed: null });
    // Restore a session from storage; rebuild singleton pages directly.
    if (closed.kind === 'harness') {
      get().openHarnessTab();
    } else if (closed.kind === 'git-diff') {
      for (const item of closed.comparisons ?? [{ selection: closed.selection }]) get().openGitDiff(item.selection);
      get().openGitDiff(closed.selection);
    } else if (closed.kind === 'editor') {
      for (const file of closed.files) get().openEditorFile(file);
      get().openEditorFile(closed.selected);
    } else {
      // Keep a failed undo available for retry and report success only after restoration.
      void sessionManager.restore(closed.id, closed.title).then(() => {
        useToastStore.getState().addToast(t('toast.tabRestored'), 'success');
      }).catch((error: unknown) => {
        set(state => ({ lastClosed: state.lastClosed ?? closed }));
        useToastStore.getState().addToast(t('Could not restore session: {{error}}', { error: String(error) }), 'error');
      });
      return;
    }
    useToastStore.getState().addToast(t('toast.tabRestored'), 'success');
    get().ensureStartPages();
  },
  activate: (id) => {
    const prev = get().activeId;
    const previous = get().tabs.find(tab => tab.id === prev);
    const focused = previous && isSessionTab(previous) ? findLeaf(previous.layout, useTerminalStore.getState().focusedPaneId ?? '') ?? firstLeaf(previous.layout) : null;
    if (focused?.kind === 'local') set({ lastLocalPaneId: focused.id });
    useUiStore.getState().setSettingsOpen(false);
    set({ activeId: id });
    // Restore a manually fullscreened pane before falling back to the first pane.
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) {
      const area = workspaceAreaForKind(tab.kind);
      if (useWorkspaceNavigation.getState().area !== 'unified') useWorkspaceNavigation.getState().selectArea(area);
      useWorkspaceNavigation.getState().rememberTab(area, id);
    }
    const terminal = useTerminalStore.getState();
    const pane = tab && isSessionTab(tab) ? layoutLeaves(tab.layout).find(item => terminal.manualFullscreen[item.id]) ?? firstLeaf(tab.layout) : null;
    terminal.setFocusedPane(pane?.id ?? id);
    get().ensureStartPages();
  },
  ensureStartPages: () => {
    const state = get();
    const currentArea = useWorkspaceNavigation.getState().area;
    const ai = useAiWorkspace.getState();
    // Conversations and ACP sessions live in the AI stores, so they count as strip entries too.
    const connections = useHarnessWorkspace.getState().connections;
    const startKinds = { terminal: 'start', code: 'start-code', ai: 'start-ai' } as const;
    let tabs = state.tabs;
    let activeId = state.activeId;
    let changed = false;
    for (const area of ['terminal', 'code', 'ai'] as const) {
      const kind = startKinds[area];
      const start = tabs.find(tab => isStartTab(tab) && tab.kind === kind);
      // Inactive areas are seeded when they become active; stale placeholders are always cleaned.
      if (area !== currentArea && !start) continue;
      const work = area === 'ai'
        ? ai.nativeTabs.length + connections.length + tabs.filter(tab => tab.kind === 'ai-history' || tab.kind === 'usage').length
        : tabs.filter(tab => workspaceAreaForKind(tab.kind) === area && !isStartTab(tab)).length;
      if (!work && !start) {
        const id = nextTabId();
        tabs = [...tabs, { id, title: START_TITLE, kind, titleSource: 'manual' }];
        changed = true;
        if (currentArea === area) activeId = id;
      } else if (work && start) {
        tabs = tabs.filter(tab => tab.id !== start.id);
        changed = true;
        if (activeId === start.id) {
          activeId = area === 'ai'
            ? tabs.find(tab => tab.kind === 'harness')?.id ?? ''
            : tabs.find(tab => workspaceAreaForKind(tab.kind) === area && !isStartTab(tab))?.id ?? '';
        }
      } else if (!work && start && area === 'ai' && currentArea === 'ai') {
        // The harness page is an empty container without sessions; show the placeholder instead.
        const active = tabs.find(tab => tab.id === activeId);
        if (active?.kind === 'harness') { activeId = start.id; changed = true; }
      }
    }
    if (changed) set({ tabs, activeId });
  },
  titleFromMessage: (id, text) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !isSessionTab(tab) || !canApplyTitle(tab.titleSource, 'message')) return;
    const line = text.trim().split('\n', 1)[0]?.trim() ?? '';
    if (!line) return;
    const newTitle = truncateTitle(line, MESSAGE_TITLE_LEN);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: newTitle, titleSource: 'message' } : t)),
    }));
    sessionManager.rename(id, newTitle);
  },
  titleFromCommand: (id, text) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !isSessionTab(tab) || !canApplyTitle(tab.titleSource, 'command')) return;
    const label = normalizeCommandForTitle(text);
    if (!label) return;
    const newTitle = truncateTitle(label, COMMAND_TITLE_LEN);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: newTitle, titleSource: 'command' } : t)),
    }));
    sessionManager.rename(id, newTitle);
  },
  autoTitle: (id, title, options) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !isSessionTab(tab) || !title) return;
    // A manual name is only replaced when the caller explicitly asks (user-triggered regenerate).
    if (tab.titleSource === 'manual' && !options?.allowManual) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title, titleSource: 'ai' } : t)),
    }));
    sessionManager.rename(id, title);
  },
  renameTab: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: title || defaultTitle(), titleSource: 'manual' } : t)),
    }));
    if (title) useToastStore.getState().addToast(t('toast.renamed', { title }), 'success');
    if (get().tabs.find(tab => tab.id === id)?.kind === 'session') sessionManager.rename(id, title);
  },
  setTerminalCwd: (terminalId, cwd) => {
    set((s) => ({ terminalCwds: { ...s.terminalCwds, [terminalId]: cwd } }));
    const owner = get().tabs.find((tab) => isSessionTab(tab) && layoutLeaves(tab.layout).some((pane) => pane.id === terminalId));
    if (!owner || !isSessionTab(owner) || findLeaf(owner.layout, terminalId)?.cwd === cwd) return;

    const terminal = findLeaf(owner.layout, terminalId)!;
    const layout = replaceLeaf(owner.layout, terminalId, { ...terminal, cwd });
    set((s) => ({ tabs: s.tabs.map((tab) => tab.id === owner.id && isSessionTab(tab) ? { ...tab, layout } : tab) }));
    sessionManager.saveLayout(owner.id, layout);
    if (firstLeaf(layout).id === terminalId) void sessionManager.setCwd(owner.id, cwd);
  },
  dropTerminalCwd: (terminalId) => {
    set((s) => {
      if (!(terminalId in s.terminalCwds)) return s;
      const terminalCwds = { ...s.terminalCwds };
      delete terminalCwds[terminalId];
      return { terminalCwds };
    });
  },
  setProgramTitle: (terminalId, title) => {
    const next = title.trim();
    set((s) => {
      if (next) {
        if (s.programTitles[terminalId] === next) return s;
        return { programTitles: { ...s.programTitles, [terminalId]: next } };
      }
      if (!(terminalId in s.programTitles)) return s;
      const programTitles = { ...s.programTitles };
      delete programTitles[terminalId];
      return { programTitles };
    });
  },
  setWindowLayout: (id, layout) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && isSessionTab(t) ? { ...t, layout } : t)),
    }));
    sessionManager.saveLayout(id, layout);
  },
  detachTerminalPane: (paneId) => {
    const { tabs } = get();
    const owner = tabs.find((tab): tab is Extract<Tab, { kind: 'session' }> =>
      isSessionTab(tab) && layoutLeaves(tab.layout).some(terminal => terminal.id === paneId));
    if (!owner || countLeaves(owner.layout) < 2) return;
    const id = nextTabId();
    const snapshot = putContainer(useWorkbenchStore.getState().snapshot, { id: owner.id, scope: 'terminal', layout: terminalWorkspaceLayout(owner.layout), focused: paneId, groupId: owner.groupId });
    const detached = detachContainerPane(snapshot, owner.id, paneId, id);
    const specs = layoutLeaves(owner.layout);
    const layout = terminalResourceLayout(detached.tabs.find(tab => tab.id === owner.id)!.layout, specs)!;
    const moved = terminalResourceLayout(detached.tabs.find(tab => tab.id === id)!.layout, specs)!;
    const created: Tab = { id, title: owner.title, kind: 'session', groupId: owner.groupId, layout: moved };
    set((s) => {
      const tabs = s.tabs.flatMap(tab => tab.id === owner.id
        ? [{ ...owner, layout }, created]
        : [tab]);
      return { tabs, activeId: id };
    });
    useWorkbenchStore.getState().update(() => detached);
    sessionManager.saveLayout(owner.id, layout);
    const payload = serializeSession(created);
    if (payload) sessionManager.create(id, created.title, undefined, payload.kind, payload.payload);
    const transfer = () => { void sessionManager.transferPanes(owner.id, id, [paneId]).catch(error => reportWorkbenchFailure(error, transfer)); };
    transfer();
    useTerminalStore.getState().setFocusedPane(paneId);
  },
  splitFocusedDirect: (dir) => {
    const ws = get();
    const tab = ws.tabs.find((t) => t.id === ws.activeId);
    if (!tab || !isSessionTab(tab)) return;
    if (countLeaves(tab.layout) >= 4) {
      useToastStore.getState().addToast(t('At most 4 terminals'), 'info');
      return;
    }
    const termId = getFocusedTerminalId();
    const src = findLeaf(tab.layout, termId);
    if (!src) return;
    const newId = nextTerminalId(tab.id, tab.layout);
    const spec: TerminalSpec = {
      id: newId, kind: src.kind, shellType: src.shellType,
      ssh: src.ssh ? { ...src.ssh } : undefined, cwd: src.cwd,
      // 继承源模式；源未设置（老会话）则回退：SSH 经典、local 按 shell 类型
      openMode: src.openMode ?? (src.kind === 'ssh' ? 'classic' : defaultOpenModeForShell(src.shellType)),
    };
    const next = splitLeaf(tab.layout, termId, dir, 'second', spec);
    ws.setWindowLayout(tab.id, next);
    useTerminalStore.getState().setFocusedPane(newId);
  },
  closeTerminal: (terminalId) => {
    const ws = get();
    const tab = ws.tabs.find(tab => isSessionTab(tab) && layoutLeaves(tab.layout).some(terminal => terminal.id === terminalId));
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
    useInputStore.getState().dropPane(terminalId);
    ws.dropTerminalCwd(terminalId);
    ws.setProgramTitle(terminalId, '');
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
          .filter((g: BackendGroupEntry) => !g.archived && g.session_count > 0 && (!g.id.startsWith('group:') || g.id.startsWith('group:terminal:')))
          .map((g: BackendGroupEntry) => ({ id: g.id, title: g.title, collapsed: g.collapsed })),
      });
    } catch {
      // 后端不可用时保持空分组
    }
  },

  duplicateTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !isSessionTab(tab)) return;
    const newId = nextTabId();
    // 克隆整棵布局（含多终端分屏），终端 id 全部重排，PTY 会话全新
    const layout = cloneLayout(tab.layout, newId);
    const newTab: Tab = {
      id: newId,
      title: t('{{name}} copy', { name: tab.title }),
      kind: 'session',
      // The copy suffix is a generated fallback, not a user rename; live OSC titles can override it.
      titleSource: tab.titleSource === 'manual' ? undefined : tab.titleSource,
      groupId: tab.groupId,
      layout,
    };
    set((s) => ({ tabs: [...s.tabs, newTab], activeId: newId }));
    const ser = serializeSession(newTab)!;
    sessionManager.create(newId, newTab.title, undefined, ser.kind, ser.payload);
    if (newTab.groupId) sessionSetGroup(newId, newTab.groupId).catch((e) =>
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
    const removed: WorkspaceGroup[] = groups.filter(group => emptyIds.includes(group.id)).map(group => ({ ...group, scope: 'terminal' }));
    const retry = () => {
      void import('../services/workbench').then(module => module.pruneEmptyWorkspaceGroups(removed)).catch(error => reportWorkbenchFailure(error, retry));
    };
    retry();
  },

}));

useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  const tab = state.tabs.find(item => item.id === state.activeId);
  if (!tab) return;
  const area = workspaceAreaForKind(tab.kind);
  if (useWorkspaceNavigation.getState().area !== 'unified') useWorkspaceNavigation.getState().selectArea(area);
  useWorkspaceNavigation.getState().rememberTab(area, tab.id);
  const terminal = useTerminalStore.getState();
  const pane = isSessionTab(tab) ? layoutLeaves(tab.layout).find(item => terminal.manualFullscreen[item.id]) ?? firstLeaf(tab.layout) : null;
  terminal.setFocusedPane(pane?.id ?? tab.id);
});

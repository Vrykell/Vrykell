import { describe, it, expect, beforeEach, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import {
  useWorkspaceStore, isSessionTab, getFocusedCwd, firstTerminalOf,
  terminalsOf, serializeSession, nextTerminalId, type Tab,
} from '@features/workspace/stores/workspace';
import { resolveDisplayTitle } from '@features/workspace/model/sessionTitle';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useInputStore } from '@features/terminal/stores/input';
import { leaf, firstLeaf } from '@features/workspace/model/windowLayout';
import { useUiStore } from './ui';
import { useWorkspaceNavigation } from './navigation';

const initial = useWorkspaceStore.getState();

describe('workspace store', () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: false });
    useWorkspaceStore.setState(initial, true);
    // Simulate app startup: create the default terminal when no session is restored (the store no longer ships an initial tab)
    useWorkspaceStore.getState().addTab({});
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  });

  it('starts with no tabs; startup logic creates the default terminal', () => {
    useWorkspaceStore.setState(initial, true);
    const empty = useWorkspaceStore.getState();
    expect(empty.tabs).toHaveLength(0);
    empty.addTab({});
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
  });

  it('addTab creates and activates a tab', () => {
    useWorkspaceStore.getState().addTab();
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[1]!.id);
  });

  it('moves a terminal pane out into a new session tab without restarting the pane', () => {
    const layout = {
      type: 'split' as const, dir: 'row' as const, ratio: 0.5,
      first: leaf({ id: 'left', kind: 'local', shellType: 'bash' }),
      second: leaf({ id: 'right', kind: 'local', shellType: 'bash' }),
    };
    useWorkspaceStore.setState({ tabs: [{ id: 'owner', title: 'Project', kind: 'session', layout }], activeId: 'owner' });
    useWorkspaceStore.getState().detachTerminalPane('right');

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(2);
    const [owner, detached] = state.tabs as [Tab, Tab];
    expect(owner).toMatchObject({ id: 'owner', kind: 'session', layout: { type: 'leaf', terminal: { id: 'left' } } });
    expect(detached).toMatchObject({ kind: 'session', layout: { type: 'leaf', terminal: { id: 'right' } } });
    expect(state.activeId).toBe(detached.id);
    expect(useTerminalStore.getState().focusedPaneId).toBe('right');
  });

  it('keeps a single-pane session together when asked to detach it', () => {
    const layout = leaf({ id: 'only', kind: 'local' });
    useWorkspaceStore.setState({ tabs: [{ id: 'owner', title: 'Project', kind: 'session', layout }], activeId: 'owner' });
    useWorkspaceStore.getState().detachTerminalPane('only');
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
  });

  it('closeTab activates the neighbouring tab after closing the active one', () => {
    const s0 = useWorkspaceStore.getState();
    s0.addTab();
    s0.addTab();
    const tabs = useWorkspaceStore.getState().tabs;
    useWorkspaceStore.getState().activate(tabs[1]!.id);
    useWorkspaceStore.getState().closeTab(tabs[1]!.id);
    const s = useWorkspaceStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual([tabs[0]!.id, tabs[2]!.id]);
    expect(s.activeId).toBe(tabs[0]!.id);
  });

  it('closing the last tab leaves the terminal start page', () => {
    const only = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().closeTab(only);
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.kind).toBe('start');
    expect(s.activeId).toBe(s.tabs[0]!.id);
  });

  it('keeps the AI start page visible instead of an empty harness container', () => {
    useWorkspaceStore.setState({ tabs: [], activeId: '' });
    useWorkspaceNavigation.getState().selectArea('ai');
    const ws = useWorkspaceStore.getState();
    const harness = ws.addTab({ kind: 'harness' });
    const start = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'start-ai');
    expect(start).toBeDefined();
    expect(useWorkspaceStore.getState().activeId).toBe(start!.id);
    // Re-activating the empty container falls back to the start page again.
    useWorkspaceStore.getState().activate(harness);
    expect(useWorkspaceStore.getState().activeId).toBe(start!.id);
    useWorkspaceNavigation.getState().selectArea('terminal');
  });

  it('opening the harness page switches the workspace to the AI area', () => {
    useWorkspaceNavigation.getState().selectArea('terminal');
    useWorkspaceStore.getState().openHarnessTab();
    expect(useWorkspaceNavigation.getState().area).toBe('ai');
    expect(useWorkspaceStore.getState().tabs.some(tab => tab.kind === 'harness')).toBe(true);
    useWorkspaceNavigation.getState().selectArea('terminal');
  });

  it('closeTab also clears per-terminal input drafts', () => {
    const ws = useWorkspaceStore.getState();
    const tab = ws.tabs.find(isSessionTab)!;
    const paneId = firstLeaf(tab.layout).id;
    useInputStore.getState().setText(paneId, 'stale draft');
    ws.closeTab(tab.id);
    expect(useInputStore.getState().byPane[paneId]).toBeUndefined();
  });

  it('keeps an active settings page when the last background session closes', () => {
    const ws = useWorkspaceStore.getState();
    const sessionId = ws.tabs[0]!.id;
    ws.openSettings();
    ws.closeTab(sessionId);

    const state = useWorkspaceStore.getState();
    expect(state.tabs.some(isSessionTab)).toBe(false);
    expect(state.tabs.map(tab => tab.kind)).toEqual(['start']);
    expect(state.activeId).toBe(state.tabs[0]!.id);
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('addTab accepts a shell type', () => {
    useWorkspaceStore.getState().addTab({ shellType: 'zsh' });
    const t = useWorkspaceStore.getState().tabs[1]!;
    expect(t.kind).toBe('session');
    expect(firstTerminalOf(t)!.shellType).toBe('zsh');
  });

  it('addTab accepts SSH connection metadata', () => {
    useWorkspaceStore.getState().addTab({
      kind: 'ssh',
      ssh: { name: '生产服务器', host: 'prod.example.com', user: 'root', port: 22 },
    });
    const t = useWorkspaceStore.getState().tabs[1]!;
    const term = firstTerminalOf(t)!;
    expect(t.kind).toBe('session');
    expect(term.kind).toBe('ssh');
    expect(term.ssh?.name).toBe('生产服务器');
    expect(term.ssh?.host).toBe('prod.example.com');
    expect(term.ssh?.user).toBe('root');
    expect(term.ssh?.port).toBe(22);
  });

  it('openHistoryTab creates a history tab and never duplicates it', () => {
    const ws = useWorkspaceStore.getState();
    ws.openHistoryTab();
    let s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.kind).toBe('history');
    expect(s.activeId).toBe(s.tabs[1]!.id);
    // Opening it again reuses the existing history tab
    s.openHistoryTab();
    s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
  });

  it.each(['history', 'ai-history', 'usage'] as const)('keeps %s singleton through direct creation and duplication', kind => {
    const ws = useWorkspaceStore.getState();
    const id = ws.addTab({ kind });
    ws.activate(ws.tabs[0]!.id);
    expect(ws.addTab({ kind })).toBe(id);
    expect(useWorkspaceStore.getState().activeId).toBe(id);
    ws.duplicateTab(id);
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === kind)).toHaveLength(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('opens a single AI history page and never reopens it from the close history', () => {
    const ws = useWorkspaceStore.getState();
    ws.openAiHistoryTab();
    const id = useWorkspaceStore.getState().activeId;
    expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === id)?.kind).toBe('ai-history');
    ws.openAiHistoryTab();
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(1);
    ws.closeTab(id);
    expect(useWorkspaceStore.getState().lastClosed).toBeNull();
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(0);
  });

  it('opens a single usage page and never reopens it from the close history', () => {
    const ws = useWorkspaceStore.getState();
    ws.openUsageTab();
    const id = useWorkspaceStore.getState().activeId;
    const tab = useWorkspaceStore.getState().tabs.find(item => item.id === id);
    expect(tab?.kind).toBe('usage');
    expect(tab?.title).toBe('用量统计');
    ws.openUsageTab();
    expect(useWorkspaceStore.getState().tabs.filter(item => item.kind === 'usage')).toHaveLength(1);
    ws.closeTab(id);
    expect(useWorkspaceStore.getState().lastClosed).toBeNull();
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.filter(item => item.kind === 'usage')).toHaveLength(0);
  });

  it('allows OSC titles to override a copied manual title while retaining the copy fallback', () => {
    const ws = useWorkspaceStore.getState();
    const original = ws.tabs[0]!;
    ws.renameTab(original.id, '手动标题');
    ws.duplicateTab(original.id);

    const copy = useWorkspaceStore.getState().tabs.find(tab => tab.id === useWorkspaceStore.getState().activeId)!;
    expect(copy.title).toBe('手动标题 副本');
    expect(copy.titleSource).toBeUndefined();
    expect(resolveDisplayTitle(copy.title, copy.titleSource, 'running program')).toBe('running program');
    expect(resolveDisplayTitle(copy.title, copy.titleSource, '')).toBe('手动标题 副本');
  });

  it('keeps the terminal start page when a page in another area closes', () => {
    useWorkspaceStore.setState({ tabs: [], activeId: '' });
    const ws = useWorkspaceStore.getState();
    const settings = ws.addTab({ kind: 'ai-history' });
    const history = ws.addTab({ kind: 'history' });
    ws.closeTab(history);
    const start = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'start');
    expect(start).toBeDefined();
    expect(useWorkspaceStore.getState().activeId).toBe(start!.id);
    const reopened = ws.addTab({ kind: 'history' });
    ws.activate(settings);
    ws.closeTab(reopened);
    expect(useWorkspaceStore.getState().activeId).toBe(settings);
  });

  it('addTab returns the new tab id and defaults the title to the terminal type name', () => {
    const id = useWorkspaceStore.getState().addTab({ shellType: 'bash' });
    const s = useWorkspaceStore.getState();
    expect(id).toBe(s.tabs[1]!.id);
    expect(s.tabs[1]!.title).toBe('Bash');
  });

  it('titleFromCommand names the tab from the first command and never overwrites it', () => {
    const id = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().titleFromCommand(id, 'npm run dev');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === id)!.title).toBe('npm run dev');
    useWorkspaceStore.getState().titleFromCommand(id, 'echo hi');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === id)!.title).toBe('npm run dev');
  });

  it('titleFromMessage only overrides the default title', () => {
    const id = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().titleFromMessage(id, '帮我写一个快速排序');
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('帮我写一个快速排序');
    useWorkspaceStore.getState().titleFromMessage(id, '第二条消息');
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('帮我写一个快速排序');
  });

  it('setTerminalCwd / dropTerminalCwd manage the terminal cwd', () => {
    const tabId = useWorkspaceStore.getState().tabs[0]!.id;
    const paneId = `${tabId}#0`;
    useWorkspaceStore.getState().setTerminalCwd(paneId, '/a');
    expect(useWorkspaceStore.getState().terminalCwds[paneId]).toBe('/a');
    const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId)!;
    expect(isSessionTab(tab) && tab.layout.type === 'leaf' && tab.layout.terminal.cwd).toBe('/a');
    useWorkspaceStore.getState().dropTerminalCwd(paneId);
    expect(useWorkspaceStore.getState().terminalCwds[paneId]).toBeUndefined();
  });

  it('getFocusedCwd reads the focused terminal cwd (falling back to spec.cwd)', () => {
    const tabId = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().setTerminalCwd(`${tabId}#0`, '/main');
    useTerminalStore.setState({ focusedPaneId: `${tabId}#0`, sessions: { [`${tabId}#0`]: 's1' } });
    expect(getFocusedCwd()).toBe('/main');
  });

  it('hides empty active groups without deleting their historical membership', () => {
    useWorkspaceStore.setState({
      tabs: [
        { id: 't0', title: 'a', kind: 'session', groupId: 'g1', layout: leaf({ id: 't0#0', kind: 'local' }) },
        { id: 't1', title: 'b', kind: 'session', layout: leaf({ id: 't1#0', kind: 'local' }) },
      ],
      groups: [
        { id: 'g1', title: '一', collapsed: false },
        { id: 'g2', title: '二', collapsed: false },
      ],
    });
    useWorkspaceStore.getState().pruneEmptyGroups();
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g1']);
    expect(invokeMock).not.toHaveBeenCalledWith('group_delete', expect.anything());
  });
});

describe('workspace store extensions', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initial, true);
    useWorkspaceStore.getState().addTab({});
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  });

  it('opens settings without creating a tab or changing the active session', () => {
    const ws = useWorkspaceStore.getState();
    const before = ws.activeId;
    ws.openSettings();
    ws.openSettings();
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeId).toBe(before);
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('activate switches the active tab and moves focus to its first terminal', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    expect(useWorkspaceStore.getState().activeId).toBe(a);
    expect(useTerminalStore.getState().focusedPaneId).toBe(`${a}#0`);
  });

  it('closeTab on an inactive tab keeps activeId and moves focus away from the closed tab', () => {
    const ws = useWorkspaceStore.getState();
    const initialTab = ws.tabs[0]!.id;
    const b = ws.addTab({ title: 'b' });
    ws.activate(b);
    useTerminalStore.setState({ focusedPaneId: `${initialTab}#0` });
    ws.closeTab(initialTab);
    const s = useWorkspaceStore.getState();
    expect(s.tabs.some((t) => t.id === initialTab)).toBe(false);
    expect(s.activeId).toBe(b);
    expect(useTerminalStore.getState().focusedPaneId).toBe(`${b}#0`);
    expect(s.lastClosed?.id).toBe(initialTab);
  });

  it('undoCloseTab: restores session tabs, rebuilds history tabs and is a no-op when nothing can be undone', async () => {
    invokeMock.mockImplementation(async command => ['get_session_blocks', 'list_chat_messages'].includes(command) ? [] : undefined);
    const ws = useWorkspaceStore.getState();
    const only = ws.tabs[0]!.id;
    ws.closeTab(only);
    expect(useWorkspaceStore.getState().tabs.some((t) => t.id === only)).toBe(false);
    ws.undoCloseTab();
    // Restoring is asynchronous (undoCloseTab does not await), so let microtasks and timers drain
    await new Promise((r) => setTimeout(r, 20));
    // Missing legacy payloads use the default layout after the restore is persisted.
    const s = useWorkspaceStore.getState();
    expect(s.tabs.some((t) => t.id === only)).toBe(true);
    expect(s.lastClosed).toBeNull();
    // History tabs are system pages, so closing one does not enter the restorable history
    ws.openHistoryTab();
    const histId = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!.id;
    ws.closeTab(histId);
    expect(useWorkspaceStore.getState().lastClosed).toBeNull();
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.some((t) => t.kind === 'history')).toBe(false);
    // Nothing to undo
    useWorkspaceStore.setState({ lastClosed: null });
    const before = useWorkspaceStore.getState().tabs.length;
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.length).toBe(before);
  });

  it('keeps a failed undo available without creating a tab', async () => {
    const ws = useWorkspaceStore.getState();
    const id = ws.tabs[0].id;
    ws.closeTab(id);
    ws.undoCloseTab();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(useWorkspaceStore.getState().lastClosed?.id).toBe(id);
    expect(useWorkspaceStore.getState().tabs.some(tab => tab.id === id)).toBe(false);
  });

  it('titleFromMessage: truncates to 14 characters and skips named or view tabs', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab();
    ws.titleFromMessage(a, 'x'.repeat(20));
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('x'.repeat(14) + '…');
    ws.titleFromMessage(a, '再来一条');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('x'.repeat(14) + '…');
    ws.openHistoryTab();
    const histId = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!.id;
    ws.titleFromMessage(histId, '历史页');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === histId)!.title).toBe('会话历史');
  });

  it('titleFromCommand: ignores an empty command and truncates to 24 characters', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab();
    ws.titleFromCommand(a, '   ');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('终端');
    ws.titleFromCommand(a, 'y'.repeat(30));
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('y'.repeat(24) + '…');
  });

  it('autoTitle: overrides automatic titles but not manual ones and ignores an empty title', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab();
    ws.autoTitle(a, '智能标题');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('智能标题');
    ws.autoTitle(a, '再改一次');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('再改一次');
    ws.renameTab(a, '手动名');
    ws.autoTitle(a, '不应覆盖');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('手动名');
    ws.autoTitle(a, '');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('手动名');
    ws.openHistoryTab();
    const histId = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!.id;
    ws.autoTitle(histId, '历史');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === histId)!.title).toBe('会话历史');
  });

  it('renameTab: an empty title falls back to the default and sets the manual source', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.autoTitle(a, '自动');
    ws.renameTab(a, '');
    const t = useWorkspaceStore.getState().tabs.find((x) => x.id === a)!;
    expect(t.title).toBe('终端');
    expect(t.titleSource).toBe('manual');
  });

  it('terminalsOf / firstTerminalOf / serializeSession / nextTerminalId', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(terminalsOf(tab).map((t) => t.id)).toEqual([`${a}#0`]);
    expect(firstTerminalOf(tab)!.id).toBe(`${a}#0`);
    expect(serializeSession(tab)).toEqual({ kind: 'session', payload: JSON.stringify({ layout: isSessionTab(tab) ? tab.layout : null }) });
    ws.openHistoryTab();
    const hist = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!;
    expect(terminalsOf(hist)).toEqual([]);
    expect(firstTerminalOf(hist)).toBeNull();
    expect(serializeSession(hist)).toBeNull();
    expect(nextTerminalId(a, isSessionTab(tab) ? tab.layout : leaf({ id: `${a}#0`, kind: 'local' }))).toBe(`${a}#1`);
    expect(nextTerminalId('fresh', leaf({ id: 'fresh#0', kind: 'local' }))).toBe('fresh#1');
    // Without terminal ids ending in #N in the layout, numbering starts at 0
    expect(nextTerminalId('x', leaf({ id: 'plain', kind: 'local' }))).toBe('x#0');
  });

  it('setWindowLayout updates and persists the layout (debounced)', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const layout = leaf({ id: `${a}#1`, kind: 'local', shellType: 'bash' });
    ws.setWindowLayout(a, layout);
    const ta = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta) ? ta.layout : null).toBe(layout);
  });

  it('splitFocusedDirect: splits the focused terminal and focuses the new pane, reporting above 4', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    ws.splitFocusedDirect('row');
    let tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(terminalsOf(tab)).toHaveLength(2);
    expect(useTerminalStore.getState().focusedPaneId).toBe(`${a}#1`);
    // No further splits are allowed after reaching 4 panes
    ws.splitFocusedDirect('row');
    ws.splitFocusedDirect('row');
    tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(terminalsOf(tab)).toHaveLength(4);
    ws.splitFocusedDirect('row');
    expect(terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!)).toHaveLength(4);
  });

  it('closeTerminal: removes a terminal and focuses the rest, closes the tab when the last terminal closes and ignores unknown terminals', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    ws.splitFocusedDirect('row');
    const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    const second = terminalsOf(tab)[1]!.id;
    ws.closeTerminal(second);
    expect(terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!)).toHaveLength(1);
    ws.closeTerminal('不存在');
    expect(useWorkspaceStore.getState().tabs.some((t) => t.id === a)).toBe(true);
    ws.closeTerminal(`${a}#0`);
    expect(useWorkspaceStore.getState().tabs.some((t) => t.id === a)).toBe(false);
  });

  it('closeFocusedTerminal closes the focused terminal', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    ws.splitFocusedDirect('row');
    const before = terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!).length;
    ws.closeFocusedTerminal();
    expect(terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!)).toHaveLength(before - 1);
  });

  it('getFocusedCwd: falls back to spec.cwd and returns undefined for a non-session active tab', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a', cwd: '/spec' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    expect(getFocusedCwd()).toBe('/spec');
    ws.setTerminalCwd(`${a}#0`, '/runtime');
    expect(getFocusedCwd()).toBe('/runtime');
    ws.openSettings();
    expect(getFocusedCwd()).toBe('/runtime');
    ws.openHistoryTab();
    expect(getFocusedCwd()).toBeUndefined();
  });

  it('dropTerminalCwd: an unknown key is safe', () => {
    const ws = useWorkspaceStore.getState();
    ws.dropTerminalCwd('nope');
    expect(useWorkspaceStore.getState().terminalCwds).toEqual({});
  });

  it('loadGroups: loads only unarchived groups with sessions and keeps the current groups on failure', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 'g1', title: '一', collapsed: false, archived: false, session_count: 2 },
      { id: 'g2', title: '二', collapsed: true, archived: true, session_count: 2 },
      { id: 'g3', title: '三', collapsed: false, archived: false, session_count: 0 },
    ]);
    await useWorkspaceStore.getState().loadGroups();
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g1']);
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await useWorkspaceStore.getState().loadGroups();
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g1']);
  });


});

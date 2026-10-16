import { describe, it, expect, beforeEach, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import {
  useWorkspaceStore, isSessionTab, getFocusedCwd, firstTerminalOf,
  terminalsOf, serializeSession, nextTerminalId,
} from '@features/workspace/stores/workspace';
import { resolveDisplayTitle } from '@features/workspace/model/sessionTitle';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { leaf } from '@features/workspace/model/windowLayout';

const initial = useWorkspaceStore.getState();

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initial, true);
    // 模拟 App 启动：无恢复会话时创建默认终端（store 本身不再内置初始标签）
    useWorkspaceStore.getState().addTab({});
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  });

  it('初始无标签，由启动逻辑创建默认终端', () => {
    useWorkspaceStore.setState(initial, true);
    const empty = useWorkspaceStore.getState();
    expect(empty.tabs).toHaveLength(0);
    empty.addTab({});
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
  });

  it('addTab 新建并激活', () => {
    useWorkspaceStore.getState().addTab();
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[1]!.id);
  });

  it('closeTab 关闭活跃标签后激活相邻标签', () => {
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

  it('关闭最后一个标签后保持空工作区', () => {
    const only = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().closeTab(only);
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeId).toBe('');
  });

  it('keeps an active settings page when the last background session closes', () => {
    const ws = useWorkspaceStore.getState();
    const sessionId = ws.tabs[0]!.id;
    ws.openSettingsTab();
    ws.closeTab(sessionId);

    const state = useWorkspaceStore.getState();
    expect(state.tabs.some(isSessionTab)).toBe(false);
    expect(state.activeId).toBe(state.tabs.find(tab => tab.kind === 'settings')!.id);
  });

  it('reorders singleton pages with loose sessions without persisting or grouping them', () => {
    const ws = useWorkspaceStore.getState();
    const session = ws.tabs[0]!.id;
    const settings = ws.addTab({ kind: 'settings' });
    const history = ws.addTab({ kind: 'history' });
    invokeMock.mockClear();
    ws.moveTab(history, null, 0);
    expect(useWorkspaceStore.getState().tabs.map(tab => tab.id)).toEqual([history, session, settings]);
    ws.moveTab(settings, null, 1);
    expect(useWorkspaceStore.getState().tabs.map(tab => tab.id)).toEqual([history, settings, session]);
    ws.moveTab(settings, 'group', 0);
    expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === settings)).not.toHaveProperty('groupId');
    expect(invokeMock).not.toHaveBeenCalled();
    ws.activate(settings);
    ws.closeTab(session);
    expect(useWorkspaceStore.getState().activeId).toBe(settings);
  });

  it('addTab 支持指定 shell 类型', () => {
    useWorkspaceStore.getState().addTab({ shellType: 'zsh' });
    const t = useWorkspaceStore.getState().tabs[1]!;
    expect(t.kind).toBe('session');
    expect(firstTerminalOf(t)!.shellType).toBe('zsh');
  });

  it('addTab 支持 ssh 连接元数据', () => {
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

  it('openHistoryTab 新建历史标签页且不重复创建', () => {
    const ws = useWorkspaceStore.getState();
    ws.openHistoryTab();
    let s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.kind).toBe('history');
    expect(s.activeId).toBe(s.tabs[1]!.id);
    // 再次打开复用已有历史标签页
    s.openHistoryTab();
    s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
  });

  it.each(['history', 'ai-history', 'settings', 'usage'] as const)('keeps %s singleton through direct creation and duplication', kind => {
    const ws = useWorkspaceStore.getState();
    const id = ws.addTab({ kind });
    ws.activate(ws.tabs[0]!.id);
    expect(ws.addTab({ kind })).toBe(id);
    expect(useWorkspaceStore.getState().activeId).toBe(id);
    ws.duplicateTab(id);
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === kind)).toHaveLength(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('opens and restores one AI history page independently of terminal sessions', () => {
    const ws = useWorkspaceStore.getState();
    ws.openAiHistoryTab();
    const id = useWorkspaceStore.getState().activeId;
    expect(useWorkspaceStore.getState().tabs.find(tab => tab.id === id)?.kind).toBe('ai-history');
    ws.openAiHistoryTab();
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(1);
    ws.closeTab(id);
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(1);
  });

  it('opens and restores one usage page independently of terminal sessions', () => {
    const ws = useWorkspaceStore.getState();
    ws.openUsageTab();
    const id = useWorkspaceStore.getState().activeId;
    const tab = useWorkspaceStore.getState().tabs.find(item => item.id === id);
    expect(tab?.kind).toBe('usage');
    expect(tab?.title).toBe('用量统计');
    ws.openUsageTab();
    expect(useWorkspaceStore.getState().tabs.filter(item => item.kind === 'usage')).toHaveLength(1);
    ws.closeTab(id);
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.filter(item => item.kind === 'usage')).toHaveLength(1);
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

  it('keeps the remaining singleton active when no terminal sessions are open', () => {
    useWorkspaceStore.setState({ tabs: [], activeId: '' });
    const ws = useWorkspaceStore.getState();
    const settings = ws.addTab({ kind: 'settings' });
    const history = ws.addTab({ kind: 'history' });
    ws.closeTab(history);
    expect(useWorkspaceStore.getState().activeId).toBe(settings);
    const reopened = ws.addTab({ kind: 'history' });
    ws.activate(settings);
    ws.closeTab(reopened);
    expect(useWorkspaceStore.getState().activeId).toBe(settings);
  });

  it('addTab 返回新标签 id，默认标题为终端类型名', () => {
    const id = useWorkspaceStore.getState().addTab({ shellType: 'bash' });
    const s = useWorkspaceStore.getState();
    expect(id).toBe(s.tabs[1]!.id);
    expect(s.tabs[1]!.title).toBe('Bash');
  });

  it('titleFromCommand 用首条命令命名且不重复覆盖', () => {
    const id = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().titleFromCommand(id, 'npm run dev');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === id)!.title).toBe('npm run dev');
    useWorkspaceStore.getState().titleFromCommand(id, 'echo hi');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === id)!.title).toBe('npm run dev');
  });

  it('titleFromMessage 只覆盖默认标题', () => {
    const id = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().titleFromMessage(id, '帮我写一个快速排序');
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('帮我写一个快速排序');
    useWorkspaceStore.getState().titleFromMessage(id, '第二条消息');
    expect(useWorkspaceStore.getState().tabs[0]!.title).toBe('帮我写一个快速排序');
  });

  it('moveTab 组内重排：把组内第一个移到末尾', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const b = ws.addTab({ title: 'b' });
    ws.moveTab(a, 'g1', 0);
    ws.moveTab(b, 'g1', 1);
    expect(useWorkspaceStore.getState().tabs.filter((t) => isSessionTab(t) && t.groupId === 'g1').map((t) => t.id)).toEqual([a, b]);
    ws.moveTab(a, 'g1', 2);
    expect(useWorkspaceStore.getState().tabs.filter((t) => isSessionTab(t) && t.groupId === 'g1').map((t) => t.id)).toEqual([b, a]);
  });

  it('moveTab 跨组移动并追加到目标组末尾', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const b = ws.addTab({ title: 'b' });
    ws.moveTab(a, 'g1', 0);
    ws.moveTab(b, 'g2', 0);
    ws.moveTab(a, 'g2', 1);
    const s = useWorkspaceStore.getState();
    const ta = s.tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta) && ta.groupId).toBe('g2');
    expect(s.tabs.filter((t) => isSessionTab(t) && t.groupId === 'g2').map((t) => t.id)).toEqual([b, a]);
  });

  it('moveTab 移出分组到未分组', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.moveTab(a, 'g1', 0);
    const ta1 = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta1) && ta1.groupId).toBe('g1');
    ws.moveTab(a, null, 0);
    const ta2 = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta2) ? ta2.groupId : undefined).toBeUndefined();
  });

  it('moveGroup 重排分组顺序', () => {
    useWorkspaceStore.setState({
      groups: [
        { id: 'g1', title: '一', collapsed: false },
        { id: 'g2', title: '二', collapsed: false },
        { id: 'g3', title: '三', collapsed: false },
      ],
    });
    useWorkspaceStore.getState().moveGroup('g3', 0);
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g3', 'g1', 'g2']);
  });

  it('createGroupForTab 新建分组并把该标签移入', async () => {
    const a = useWorkspaceStore.getState().addTab({ title: 'a' });
    const gid = await useWorkspaceStore.getState().createGroupForTab(a);
    const s = useWorkspaceStore.getState();
    expect(gid).toBeTruthy();
    const ta = s.tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta) && ta.groupId).toBe(gid);
    expect(s.groups.find((g) => g.id === gid)!.title).toMatch(/^新分组/);
  });

  it('setTerminalCwd / dropTerminalCwd 管理终端的 cwd', () => {
    const tabId = useWorkspaceStore.getState().tabs[0]!.id;
    const paneId = `${tabId}#0`;
    useWorkspaceStore.getState().setTerminalCwd(paneId, '/a');
    expect(useWorkspaceStore.getState().terminalCwds[paneId]).toBe('/a');
    const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId)!;
    expect(isSessionTab(tab) && tab.layout.type === 'leaf' && tab.layout.terminal.cwd).toBe('/a');
    useWorkspaceStore.getState().dropTerminalCwd(paneId);
    expect(useWorkspaceStore.getState().terminalCwds[paneId]).toBeUndefined();
  });

  it('getFocusedCwd 读聚焦终端的 cwd（回退到 spec.cwd）', () => {
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

describe('workspace store 扩展', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initial, true);
    useWorkspaceStore.getState().addTab({});
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  });

  it('openSettingsTab 新建并复用', () => {
    const ws = useWorkspaceStore.getState();
    ws.openSettingsTab();
    let s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.kind).toBe('settings');
    expect(s.tabs[1]!.title).toBe('设置');
    s.openSettingsTab();
    s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(2);
  });

  it('activate 切换活跃并把聚焦回落到该窗口第一个终端', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    expect(useWorkspaceStore.getState().activeId).toBe(a);
    expect(useTerminalStore.getState().focusedPaneId).toBe(`${a}#0`);
  });

  it('closeTab 非活跃标签：activeId 不变；聚焦属于被关标签时回落', () => {
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

  it('undoCloseTab：恢复会话标签 / 历史标签重建 / 无可撤销 no-op', async () => {
    invokeMock.mockImplementation(async command => ['get_session_blocks', 'list_chat_messages'].includes(command) ? [] : undefined);
    const ws = useWorkspaceStore.getState();
    const only = ws.tabs[0]!.id;
    ws.closeTab(only);
    expect(useWorkspaceStore.getState().tabs.some((t) => t.id === only)).toBe(false);
    ws.undoCloseTab();
    // restore 是异步的（undoCloseTab 不 await），等微任务+定时器排空
    await new Promise((r) => setTimeout(r, 20));
    // Missing legacy payloads use the default layout after the restore is persisted.
    const s = useWorkspaceStore.getState();
    expect(s.tabs.some((t) => t.id === only)).toBe(true);
    expect(s.lastClosed).toBeNull();
    // 历史标签撤销（同步路径）
    ws.openHistoryTab();
    const histId = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!.id;
    ws.closeTab(histId);
    ws.undoCloseTab();
    expect(useWorkspaceStore.getState().tabs.some((t) => t.kind === 'history')).toBe(true);
    // 无可撤销
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

  it('titleFromMessage：截断 14 字；已定名/视图标签不覆盖', () => {
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

  it('titleFromCommand：空命令 no-op；截断 24 字', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab();
    ws.titleFromCommand(a, '   ');
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('终端');
    ws.titleFromCommand(a, 'y'.repeat(30));
    expect(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!.title).toBe('y'.repeat(24) + '…');
  });

  it('autoTitle：覆盖自动标题；不覆盖手动命名；空标题 no-op', () => {
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

  it('renameTab：空标题回退默认；置为手动来源', () => {
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
    // 布局里没有 #N 结尾的终端 id 时从 0 开始
    expect(nextTerminalId('x', leaf({ id: 'plain', kind: 'local' }))).toBe('x#0');
  });

  it('setWindowLayout 更新并持久化（去抖）', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const layout = leaf({ id: `${a}#1`, kind: 'local', shellType: 'bash' });
    ws.setWindowLayout(a, layout);
    const ta = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta) ? ta.layout : null).toBe(layout);
  });

  it('splitFocusedDirect：分裂聚焦终端并聚焦新 pane；超 4 个提示', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    ws.splitFocusedDirect('row');
    let tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(terminalsOf(tab)).toHaveLength(2);
    expect(useTerminalStore.getState().focusedPaneId).toBe(`${a}#1`);
    // 分裂到 4 个后不再分裂
    ws.splitFocusedDirect('row');
    ws.splitFocusedDirect('row');
    tab = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(terminalsOf(tab)).toHaveLength(4);
    ws.splitFocusedDirect('row');
    expect(terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!)).toHaveLength(4);
  });

  it('closeTerminal：移除终端并聚焦剩余；最后一个终端关闭窗口；未知终端 no-op', () => {
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

  it('closeFocusedTerminal 关闭聚焦终端', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    ws.splitFocusedDirect('row');
    const before = terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!).length;
    ws.closeFocusedTerminal();
    expect(terminalsOf(useWorkspaceStore.getState().tabs.find((t) => t.id === a)!)).toHaveLength(before - 1);
  });

  it('getFocusedCwd：回退 spec.cwd；非 session 活跃标签返回 undefined', () => {
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a', cwd: '/spec' });
    ws.activate(a);
    useTerminalStore.setState({ sessions: { [`${a}#0`]: 's0' } });
    expect(getFocusedCwd()).toBe('/spec');
    ws.setTerminalCwd(`${a}#0`, '/runtime');
    expect(getFocusedCwd()).toBe('/runtime');
    ws.openSettingsTab();
    expect(getFocusedCwd()).toBeUndefined();
  });

  it('dropTerminalCwd：不存在的 key 安全', () => {
    const ws = useWorkspaceStore.getState();
    ws.dropTerminalCwd('nope');
    expect(useWorkspaceStore.getState().terminalCwds).toEqual({});
  });

  it('loadGroups：只加载未归档且有会话的分组；失败保持', async () => {
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

  it('createGroup：空名返回空；成功建组', async () => {
    const ws = useWorkspaceStore.getState();
    expect(await ws.createGroup('   ')).toBe('');
    const id = await ws.createGroup(' 运维 ');
    expect(id).toBeTruthy();
    expect(useWorkspaceStore.getState().groups.find((g) => g.id === id)!.title).toBe('运维');
  });

  it('createGroupForTab：默认命名避开重名', async () => {
    const ws = useWorkspaceStore.getState();
    useWorkspaceStore.setState({ groups: [{ id: 'gx', title: '新分组', collapsed: false }] });
    const a = ws.addTab({ title: 'a' });
    const gid = await ws.createGroupForTab(a);
    expect(useWorkspaceStore.getState().groups.find((g) => g.id === gid)!.title).toBe('新分组 2');
    const ta2 = useWorkspaceStore.getState().tabs.find((t) => t.id === a)!;
    expect(isSessionTab(ta2) && ta2.groupId).toBe(gid);
  });

  it('renameGroup：空名 no-op；重命名生效', () => {
    const ws = useWorkspaceStore.getState();
    useWorkspaceStore.setState({ groups: [{ id: 'g1', title: '一', collapsed: false }] });
    ws.renameGroup('g1', '  ');
    expect(useWorkspaceStore.getState().groups[0]!.title).toBe('一');
    ws.renameGroup('g1', '甲');
    expect(useWorkspaceStore.getState().groups[0]!.title).toBe('甲');
  });

  it('toggleGroupCollapse 切换折叠状态', () => {
    const ws = useWorkspaceStore.getState();
    useWorkspaceStore.setState({ groups: [{ id: 'g1', title: '一', collapsed: false }] });
    ws.toggleGroupCollapse('g1');
    expect(useWorkspaceStore.getState().groups[0]!.collapsed).toBe(true);
    ws.toggleGroupCollapse('g1');
    expect(useWorkspaceStore.getState().groups[0]!.collapsed).toBe(false);
  });

  it('deleteGroup：withSessions 两种路径都清组并解除标签归属', async () => {
    const ws = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      groups: [{ id: 'g1', title: '一', collapsed: false }],
      tabs: useWorkspaceStore.getState().tabs.map((t) => (isSessionTab(t) ? { ...t, groupId: 'g1' } : t)),
    });
    await ws.deleteGroup('g1', true);
    expect(useWorkspaceStore.getState().groups).toEqual([]);
    const t0 = useWorkspaceStore.getState().tabs[0]!;
    expect(isSessionTab(t0) && t0.groupId).toBeUndefined();
    useWorkspaceStore.setState({ groups: [{ id: 'g2', title: '二', collapsed: false }] });
    await ws.deleteGroup('g2', false);
    expect(useWorkspaceStore.getState().groups).toEqual([]);
  });

  it('moveGroup：无效 id no-op；越界索引 clamp', () => {
    const ws = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      groups: [
        { id: 'g1', title: '一', collapsed: false },
        { id: 'g2', title: '二', collapsed: false },
        { id: 'g3', title: '三', collapsed: false },
      ],
    });
    ws.moveGroup('nope', 0);
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    ws.moveGroup('g3', 99);
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    ws.moveGroup('g1', 2);
    expect(useWorkspaceStore.getState().groups.map((g) => g.id)).toEqual(['g2', 'g3', 'g1']);
  });

  it('moveTab：视图标签不可分组', () => {
    const ws = useWorkspaceStore.getState();
    ws.openHistoryTab();
    const histId = useWorkspaceStore.getState().tabs.find((t) => t.kind === 'history')!.id;
    const before = useWorkspaceStore.getState().tabs;
    ws.moveTab(histId, 'g1', 0);
    expect(useWorkspaceStore.getState().tabs).toEqual(before);
  });

  it('archiveGroup：组内标签关闭、activeId 回落；全部归档后保持空工作区', async () => {
    invokeMock.mockResolvedValue(undefined);
    const ws = useWorkspaceStore.getState();
    const a = ws.addTab({ title: 'a' });
    const b = ws.addTab({ title: 'b' });
    const initialTab = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.setState({
      groups: [{ id: 'g1', title: '一', collapsed: false }],
      tabs: useWorkspaceStore.getState().tabs.map((t) =>
        isSessionTab(t) && (t.id === initialTab || t.id === a || t.id === b) ? { ...t, groupId: 'g1' } : t,
      ),
    });
    ws.activate(a);
    await ws.archiveGroup('g1');
    const s = useWorkspaceStore.getState();
    expect(s.groups.find((g) => g.id === 'g1')).toBeUndefined();
    expect(s.tabs.some((t) => t.id === a || t.id === b)).toBe(false);
    expect(s.tabs).toHaveLength(0);
    expect(s.activeId).toBe('');
    expect(invokeMock).toHaveBeenCalledWith('sessions_reorder', { groupId: 'g1', ids: [initialTab, a, b] });
  });

  it('keeps the group and tabs visible when archiving fails', async () => {
    const ws = useWorkspaceStore.getState();
    const id = ws.tabs[0].id;
    useWorkspaceStore.setState({ groups: [{ id: 'g1', title: 'Project', collapsed: false }],
      tabs: [{ ...ws.tabs[0], groupId: 'g1' } as typeof ws.tabs[number]] });
    await ws.archiveGroup('g1');
    expect(useWorkspaceStore.getState().groups[0].id).toBe('g1');
    expect(useWorkspaceStore.getState().tabs[0].id).toBe(id);
  });
});

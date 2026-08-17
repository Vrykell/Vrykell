import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, isSessionTab, getFocusedCwd, firstTerminalOf } from './workspace';
import { useTerminalStore } from './terminal';
import { leaf } from '../lib/windowLayout';

const initial = useWorkspaceStore.getState();

describe('workspace store', () => {
  beforeEach(() => useWorkspaceStore.setState(initial, true));

  it('默认有一个活跃标签', () => {
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

  it('关闭最后一个标签时自动新建一个', () => {
    const only = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().closeTab(only);
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
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
    useWorkspaceStore.getState().setTerminalCwd('t1#0', '/a');
    expect(useWorkspaceStore.getState().terminalCwds['t1#0']).toBe('/a');
    useWorkspaceStore.getState().dropTerminalCwd('t1#0');
    expect(useWorkspaceStore.getState().terminalCwds['t1#0']).toBeUndefined();
  });

  it('getFocusedCwd 读聚焦终端的 cwd（回退到 spec.cwd）', () => {
    const tabId = useWorkspaceStore.getState().tabs[0]!.id;
    useWorkspaceStore.getState().setTerminalCwd(`${tabId}#0`, '/main');
    useTerminalStore.setState({ focusedPaneId: `${tabId}#0`, sessions: { [`${tabId}#0`]: 's1' } });
    expect(getFocusedCwd()).toBe('/main');
  });

  it('pruneEmptyGroups 只删除没有任何标签的空分组', () => {
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
  });
});

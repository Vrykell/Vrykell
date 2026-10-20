/**
 * dock — 侧栏面板 store 测试。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDockStore } from '@features/workspace/stores/dock';

const RESET = { leftZone: [], rightZone: [], leftPanels: [], rightPanels: [], panelWidths: {}, collapsedPanels: [] };
beforeEach(() => {
  useDockStore.setState(RESET);
});

describe('dock store', () => {
  it('openPanel 打开到默认侧；togglePanel 关闭', () => {
    useDockStore.getState().openPanel('chat');
    const st = useDockStore.getState();
    expect(st.leftPanels.includes('chat') || st.rightPanels.includes('chat')).toBe(true);
    const openSide: 'left' | 'right' = st.leftPanels.includes('chat') ? 'left' : 'right';
    useDockStore.getState().togglePanel(openSide, 'chat');
    expect(useDockStore.getState().leftPanels.includes('chat') || useDockStore.getState().rightPanels.includes('chat')).toBe(false);
  });

  it('moveButton 在已有 zone 间移动并带出面板', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'] });
    useDockStore.getState().moveButton('chat', 'right');
    const st = useDockStore.getState();
    expect(st.rightZone).toContain('chat');
    expect(st.leftZone).not.toContain('chat');
  });

  it('setPanelWidth 拖到下限立即折叠（保持挂载 + 打折叠标记）；宽度保持 MIN', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 300 } });
    useDockStore.getState().setPanelWidth('chat', 50);
    expect(useDockStore.getState().panelWidths.chat).toBe(350);
    // 拖到最小宽度下限 → 折叠：面板不下架（状态不丢），打标记 + 宽度保持 MIN
    useDockStore.getState().setPanelWidth('chat', -1000);
    const s = useDockStore.getState();
    expect(s.leftPanels.includes('chat')).toBe(true); // 保持挂载（内容状态不丢）
    expect(s.collapsedPanels).toEqual(['chat']);
    expect(s.panelWidths.chat).toBe(160);
  });

  it('折叠后拖回（反向调宽 + 恢复面板）不再折叠', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 300 } });
    useDockStore.getState().setPanelWidth('chat', -1000); // 折叠，宽度 160
    expect(useDockStore.getState().collapsedPanels).toEqual(['chat']);
    // 拖回：SidePanel 层先 openPanel 恢复，再 setPanelWidth 调宽
    useDockStore.getState().openPanel('chat');
    useDockStore.getState().setPanelWidth('chat', 100);   // 160 → 260
    useDockStore.getState().commitPanelWidth('chat');     // 260 > MIN → 不折叠
    const s = useDockStore.getState();
    expect(s.leftPanels.includes('chat')).toBe(true);
    expect(s.collapsedPanels).toEqual([]);
    expect(s.panelWidths.chat).toBe(260);
  });

  it('折叠后松手（commit）正式下架；openPanel 恢复可用宽度', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 280 } });
    useDockStore.getState().setPanelWidth('chat', -200); // 80 ≤ MIN → 折叠（保持挂载）
    expect(useDockStore.getState().leftPanels).toEqual(['chat']);
    expect(useDockStore.getState().collapsedPanels).toEqual(['chat']);
    useDockStore.getState().commitPanelWidth('chat');    // 松手定局 → 正式下架
    expect(useDockStore.getState().leftPanels).toEqual([]);
    expect(useDockStore.getState().collapsedPanels).toEqual([]);
    useDockStore.getState().openPanel('chat');
    const s = useDockStore.getState();
    expect(s.leftPanels).toEqual(['chat']);
    expect(s.panelWidths.chat).toBe(160);
  });

  it('moveButton：同侧移动 atIndex 修正（srcIdx < idx → idx-1）', () => {
    useDockStore.setState({ leftZone: ['tabs', 'ssh', 'files', 'chat'] });
    useDockStore.getState().moveButton('tabs', 'left', 2);
    expect(useDockStore.getState().leftZone).toEqual(['ssh', 'tabs', 'files', 'chat']);
  });

  it('moves an open panel with its button across sides and replaces the destination panel', () => {
    useDockStore.setState({ leftZone: ['tabs', 'ssh'], rightZone: ['files'], rightPanels: ['files'] });
    useDockStore.getState().moveButton('tabs', 'right', 0);
    expect(useDockStore.getState().rightZone).toEqual(['tabs', 'files']);
    expect(useDockStore.getState().leftZone).toEqual(['ssh']);
    // The open source follows its action and replaces the destination sidebar.
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], rightZone: ['files'], rightPanels: ['files'] });
    useDockStore.getState().moveButton('chat', 'right');
    const s = useDockStore.getState();
    expect(s.leftPanels).toEqual([]);
    expect(s.rightPanels).toEqual(['chat']);
  });

  it('moveButton：未知 id no-op', () => {
    useDockStore.setState({ leftZone: ['tabs'] });
    const before = JSON.stringify(useDockStore.getState());
    useDockStore.getState().moveButton('nope', 'right');
    expect(JSON.stringify(useDockStore.getState())).toBe(before);
  });

  it('togglePanel switches the panel on the same side', () => {
    useDockStore.setState({ rightZone: ['files', 'chat'] });
    useDockStore.getState().togglePanel('right', 'chat');
    useDockStore.getState().togglePanel('right', 'files');
    expect(useDockStore.getState().rightPanels).toEqual(['files']);
    useDockStore.getState().togglePanel('right', 'files');
    expect(useDockStore.getState().rightPanels).toEqual([]);
  });

  it('openPanel：已打开 no-op；打开到右侧区', () => {
    useDockStore.setState({ rightZone: ['files'], rightPanels: ['files'] });
    const before = JSON.stringify(useDockStore.getState());
    useDockStore.getState().openPanel('files');
    expect(JSON.stringify(useDockStore.getState())).toBe(before);
    useDockStore.setState({ rightZone: ['files'], rightPanels: [] });
    useDockStore.getState().openPanel('files');
    expect(useDockStore.getState().rightPanels).toEqual(['files']);
  });

  it('setPanelWidth：默认宽度/未知面板/delta=0 不写', () => {
    useDockStore.setState({ rightZone: ['chat'], rightPanels: ['chat'] });
    useDockStore.getState().setPanelWidth('chat', 10);
    expect(useDockStore.getState().panelWidths.chat).toBe(330);
    useDockStore.getState().setPanelWidth('unknown', 5);
    expect(useDockStore.getState().panelWidths.unknown).toBe(205);
    const w = useDockStore.getState().panelWidths.chat;
    useDockStore.getState().setPanelWidth('chat', 0);
    expect(useDockStore.getState().panelWidths.chat).toBe(w);
  });

  it('setPanelWidth：多面板占用时按窗口上限 clamp', () => {
    // 同时打开 chat(320) + files(240)：调 chat 时 otherWidth=240
    useDockStore.setState({ rightZone: ['chat', 'files'], rightPanels: ['chat', 'files'] });
    useDockStore.getState().setPanelWidth('chat', 99999);
    const w = useDockStore.getState().panelWidths.chat!;
    expect(w).toBeGreaterThanOrEqual(160);
    expect(w).toBeLessThan(window.innerWidth); // 受终端最小宽约束，不会无限大
  });
});

describe('dock loadLayout（localStorage 种子 + 模块重载）', () => {
  async function freshStore() {
    vi.resetModules();
    const m = await import('@features/workspace/stores/dock');
    return m.useDockStore;
  }

  it('无缓存时使用默认布局', async () => {
    localStorage.removeItem('dock-layout-v4');
    localStorage.removeItem('dock-layout-v3');
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['tabs', 'ssh', 'files', 'git', 'command-history']);
    expect(store.getState().rightZone).toEqual(['chat']);
    expect(store.getState().leftPanels).toEqual(['tabs']);
    expect(store.getState().rightPanels).toEqual([]);
  });

  it('损坏数据回退默认并告警', async () => {
    localStorage.removeItem('dock-layout-v3');
    localStorage.setItem('dock-layout-v4', 'not-json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['tabs', 'ssh', 'files', 'git', 'command-history']);
    expect(store.getState().leftPanels).toEqual(['tabs']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('normalizes missing navigation panels to the left and the assistant to the right', async () => {
    localStorage.removeItem('dock-layout-v3');
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['tabs'], rightZone: [],
      leftPanels: [], rightPanels: [],
      panelWidths: {},
    }));
    const store = await freshStore();
    const s = store.getState();
    expect(s.leftZone).toEqual(['tabs', 'files', 'ssh', 'command-history', 'git']);
    expect(s.rightZone).toEqual(['chat']);
  });

  it('面板顺序对齐按钮顺序', async () => {
    localStorage.removeItem('dock-layout-v3');
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['tabs', 'ssh'], rightZone: ['files'],
      leftPanels: ['ssh', 'tabs'], rightPanels: ['files'],
      panelWidths: {},
    }));
    const store = await freshStore();
    expect(store.getState().leftPanels).toEqual(['tabs']);
  });

  it('drops the settings page action when restoring older layouts', async () => {
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['settings', 'files', 'tabs', 'ssh'], rightZone: ['chat', 'settings'],
      leftPanels: ['files'], rightPanels: ['chat'], panelWidths: {}, widthPreset: 'compact',
    }));
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['files', 'tabs', 'ssh', 'command-history', 'git']);
    expect(store.getState().rightZone).toEqual(['chat']);
    store.getState().moveButton('settings', 'left', 0);
    expect(store.getState().leftZone).toEqual(['files', 'tabs', 'ssh', 'command-history', 'git']);
  });

  it('appends to the same side when no insertion index is specified', () => {
    useDockStore.setState({ leftZone: ['tabs', 'ssh', 'files'], leftPanels: ['tabs'] });
    useDockStore.getState().moveButton('tabs', 'left');
    expect(useDockStore.getState().leftZone).toEqual(['ssh', 'files', 'tabs']);
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
  });

  it('keeps the open panel visible during same-side reordering and persists the exact order', () => {
    useDockStore.setState({ leftZone: ['tabs', 'ssh', 'files'], rightZone: ['chat'], leftPanels: ['tabs'], rightPanels: ['chat'] });
    useDockStore.getState().moveButton('tabs', 'left', 3);
    const state = useDockStore.getState();
    expect(state.leftZone).toEqual(['ssh', 'files', 'tabs']);
    expect(state.leftPanels).toEqual(['tabs']);
    expect(state.rightPanels).toEqual(['chat']);
    const saved = JSON.parse(localStorage.getItem('dock-layout-v4')!);
    expect(saved.leftZone).toEqual(state.leftZone);
    expect(saved.leftPanels).toEqual(['tabs']);
  });

  it('opens on the configured side even when an older entry point requests the other side', () => {
    useDockStore.setState({ leftZone: ['chat'], rightZone: ['files'] });
    useDockStore.getState().togglePanel('right', 'chat');
    expect(useDockStore.getState().leftPanels).toEqual(['chat']);
    useDockStore.getState().togglePanel('left', 'files');
    expect(useDockStore.getState().rightPanels).toEqual(['files']);
  });

  it('moves closed actions to an empty side without opening a sidebar', () => {
    useDockStore.setState({ leftZone: ['files'], rightZone: [], panelWidths: { files: 240 } });
    useDockStore.getState().moveButton('files', 'right');
    expect(useDockStore.getState().leftZone).toEqual([]);
    expect(useDockStore.getState().rightZone).toEqual(['files']);
    expect(useDockStore.getState().rightPanels).toEqual([]);
    expect(useDockStore.getState().panelWidths.files).toBe(240);
    useDockStore.getState().openPanel('files');
    expect(useDockStore.getState().rightPanels).toEqual(['files']);
  });

  it('restores custom left and right placement without forcing the default sides', async () => {
    localStorage.removeItem('dock-layout-v3');
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['chat', 'ssh', 'tabs'], rightZone: ['files'],
      leftPanels: ['chat'], rightPanels: ['files'], panelWidths: { chat: 350, files: 280 },
      widthPreset: 'compact',
    }));
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['chat', 'ssh', 'tabs', 'command-history', 'git']);
    expect(store.getState().rightZone).toEqual(['files']);
    expect(store.getState().leftPanels).toEqual(['chat']);
    expect(store.getState().rightPanels).toEqual(['files']);
    expect(store.getState().panelWidths).toEqual({ chat: 350, files: 280 });
  });

  it('migrates legacy placement with compact widths and only sessions open', async () => {
    localStorage.removeItem('dock-layout-v4');
    localStorage.setItem('dock-layout-v3', JSON.stringify({
      leftZone: ['tabs', 'ssh'], rightZone: ['files'],
      leftPanels: ['tabs', 'ssh'], rightPanels: ['files'],
      panelWidths: { tabs: 220, files: 280 },
    }));
    const store = await freshStore();
    const s = store.getState();
    expect(s.leftZone).toEqual(['tabs', 'ssh', 'command-history', 'git']);
    expect(s.rightZone).toEqual(['files', 'chat']);
    expect(s.leftPanels).toEqual(['tabs']);
    expect(s.rightPanels).toEqual([]);
    expect(s.panelWidths).toEqual({ tabs: 180, files: 200 });
    expect(localStorage.getItem('dock-layout-v4')).toContain('"leftPanels":["tabs"]');
  });
  it('shrinks oversized saved widths once and preserves subsequent manual resizing', async () => {
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['tabs', 'files', 'ssh'], rightZone: ['chat'],
      leftPanels: ['tabs'], rightPanels: ['chat'], panelWidths: { tabs: 251, chat: 373, files: 170 },
    }));
    const store = await freshStore();
    expect(store.getState().panelWidths).toEqual({ tabs: 180, chat: 320, files: 170 });
    store.getState().setPanelWidth('tabs', 60);
    store.getState().setPanelWidth('chat', 40);
    const reloaded = await freshStore();
    expect(reloaded.getState().panelWidths).toEqual({ tabs: 240, chat: 360, files: 170 });
    expect(reloaded.getState().leftPanels).toEqual(['tabs']);
    expect(reloaded.getState().rightPanels).toEqual(['chat']);
  });

  it('keeps a saved layout whose panel no longer exists, dropping only that id', async () => {
    localStorage.removeItem('dock-layout-v3');
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['tabs', 'usage'], rightZone: ['files', 'usage'],
      leftPanels: ['usage'], rightPanels: ['files'], panelWidths: { usage: 400 }, widthPreset: 'compact',
    }));
    const store = await freshStore();
    const s = store.getState();
    // 已移除的面板被丢弃，其余位置保留；缺失的按钮按默认补齐（设置入口固定在左下，不参与布局）
    expect(s.leftZone).toEqual(['tabs', 'ssh', 'command-history', 'git']);
    expect(s.rightZone).toEqual(['files', 'chat']);
    expect(s.leftPanels).toEqual([]);
    expect(s.rightPanels).toEqual(['files']);
    expect(s.panelWidths).toEqual({ usage: 400 });
  });

  it('repairs duplicated buttons and places saved open panels on their configured side', async () => {
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['chat', 'chat'], rightZone: ['files', 'chat', 'files', 'tabs', 'ssh'],
      leftPanels: ['files'], rightPanels: ['chat'], panelWidths: {}, widthPreset: 'compact',
    }));
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['chat', 'command-history', 'git']);
    expect(store.getState().rightZone).toEqual(['files', 'tabs', 'ssh']);
    expect(store.getState().leftPanels).toEqual(['chat']);
    expect(store.getState().rightPanels).toEqual(['files']);
  });
});

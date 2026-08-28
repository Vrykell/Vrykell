/**
 * dock — 侧栏面板 store 测试。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDockStore } from './dock';

const RESET = { leftZone: [], rightZone: [], leftPanels: [], rightPanels: [], panelWidths: {} };
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

  it('setPanelWidth 拖到下限立即折叠；宽度保持 MIN', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 300 } });
    useDockStore.getState().setPanelWidth('chat', 50);
    expect(useDockStore.getState().panelWidths.chat).toBe(350);
    // 拖到最小宽度下限 → 立即折叠（面板移除，宽度保持 MIN）
    useDockStore.getState().setPanelWidth('chat', -1000);
    const s = useDockStore.getState();
    expect(s.leftPanels.includes('chat')).toBe(false);
    expect(s.panelWidths.chat).toBe(160);
  });

  it('折叠后拖回（反向调宽 + 恢复面板）不再折叠', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 300 } });
    useDockStore.getState().setPanelWidth('chat', -1000); // 折叠，宽度 160
    expect(useDockStore.getState().leftPanels).toEqual([]);
    // 拖回：SidePanel 层先 openPanel 恢复，再 setPanelWidth 调宽
    useDockStore.getState().openPanel('chat');
    useDockStore.getState().setPanelWidth('chat', 100);   // 160 → 260
    useDockStore.getState().commitPanelWidth('chat');     // 260 > MIN → 不折叠
    const s = useDockStore.getState();
    expect(s.leftPanels.includes('chat')).toBe(true);
    expect(s.panelWidths.chat).toBe(260);
  });

  it('折叠后 commit 幂等；openPanel 恢复可用宽度', () => {
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], panelWidths: { chat: 280 } });
    useDockStore.getState().setPanelWidth('chat', -200); // 80 ≤ MIN → 立即折叠
    expect(useDockStore.getState().leftPanels).toEqual([]);
    useDockStore.getState().commitPanelWidth('chat');    // 幂等
    expect(useDockStore.getState().leftPanels).toEqual([]);
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

  it('moveButton：跨侧带 atIndex；打开的面板随按钮关闭', () => {
    useDockStore.setState({ leftZone: ['tabs', 'ssh'], rightZone: ['files'], rightPanels: ['files'] });
    useDockStore.getState().moveButton('tabs', 'right', 0);
    expect(useDockStore.getState().rightZone).toEqual(['tabs', 'files']);
    expect(useDockStore.getState().leftZone).toEqual(['ssh']);
    // from 侧打开的面板被关闭
    useDockStore.setState({ leftZone: ['chat'], leftPanels: ['chat'], rightZone: ['files'], rightPanels: ['files'] });
    useDockStore.getState().moveButton('chat', 'right');
    const s = useDockStore.getState();
    expect(s.leftPanels).toEqual([]);
    expect(s.rightPanels).toEqual(['files']);
  });

  it('moveButton：未知 id no-op', () => {
    useDockStore.setState({ leftZone: ['tabs'] });
    const before = JSON.stringify(useDockStore.getState());
    useDockStore.getState().moveButton('nope', 'right');
    expect(JSON.stringify(useDockStore.getState())).toBe(before);
  });

  it('togglePanel：右侧打开并按按钮顺序排序、再点关闭', () => {
    useDockStore.setState({ rightZone: ['files', 'chat'] });
    useDockStore.getState().togglePanel('right', 'chat');
    useDockStore.getState().togglePanel('right', 'files');
    expect(useDockStore.getState().rightPanels).toEqual(['files', 'chat']);
    useDockStore.getState().togglePanel('right', 'files');
    expect(useDockStore.getState().rightPanels).toEqual(['chat']);
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
    const m = await import('./dock');
    return m.useDockStore;
  }

  it('无缓存时使用默认布局', async () => {
    localStorage.removeItem('dock-layout-v3');
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['tabs', 'ssh']);
    expect(store.getState().rightZone).toEqual(['files']);
  });

  it('损坏数据回退默认并告警', async () => {
    localStorage.setItem('dock-layout-v3', 'not-json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await freshStore();
    expect(store.getState().leftZone).toEqual(['tabs', 'ssh']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('合法但缺新面板 id 的旧布局：追加到右侧并重排面板', async () => {
    localStorage.setItem('dock-layout-v3', JSON.stringify({
      leftZone: ['tabs'], rightZone: [],
      leftPanels: [], rightPanels: [],
      panelWidths: {},
    }));
    const store = await freshStore();
    const s = store.getState();
    expect(s.leftZone).toEqual(['tabs']);
    // 缺失的 files/ssh/chat 追加到 rightZone
    expect(s.rightZone.sort()).toEqual(['chat', 'files', 'ssh']);
  });

  it('面板顺序对齐按钮顺序', async () => {
    localStorage.setItem('dock-layout-v3', JSON.stringify({
      leftZone: ['tabs', 'ssh'], rightZone: ['files'],
      leftPanels: ['ssh', 'tabs'], rightPanels: ['files'],
      panelWidths: {},
    }));
    const store = await freshStore();
    expect(store.getState().leftPanels).toEqual(['tabs', 'ssh']);
  });
});

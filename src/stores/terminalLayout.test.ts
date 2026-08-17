import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalLayoutStore, gridDimensions, gridPosition, slotOf } from './terminalLayout';

describe('terminalLayout store（4 象限停靠）', () => {
  beforeEach(() => {
    useTerminalLayoutStore.setState({ slots: [null, null, null, null], focusedTabId: null });
  });

  it('dockTab 停靠 tab 到槽位并移动去重', () => {
    useTerminalLayoutStore.getState().dockTab('a', 0);
    useTerminalLayoutStore.getState().dockTab('b', 1);
    expect(useTerminalLayoutStore.getState().slots).toEqual(['a', 'b', null, null]);
    useTerminalLayoutStore.getState().dockTab('a', 3);
    expect(useTerminalLayoutStore.getState().slots).toEqual([null, 'b', null, 'a']);
  });

  it('undockTab 移除停靠', () => {
    useTerminalLayoutStore.getState().dockTab('a', 0);
    useTerminalLayoutStore.getState().undockTab('a');
    expect(useTerminalLayoutStore.getState().slots).toEqual([null, null, null, null]);
  });

  it('firstFreeSlot 返回第一个空槽', () => {
    useTerminalLayoutStore.getState().dockTab('a', 0);
    useTerminalLayoutStore.getState().dockTab('b', 1);
    expect(useTerminalLayoutStore.getState().firstFreeSlot()).toBe(2);
  });

  it('reconcile 剔除不存在的 tab id', () => {
    useTerminalLayoutStore.getState().dockTab('a', 0);
    useTerminalLayoutStore.getState().dockTab('gone', 1);
    useTerminalLayoutStore.getState().reconcile(new Set(['a']));
    expect(useTerminalLayoutStore.getState().slots).toEqual(['a', null, null, null]);
  });

  it('slotOf 找到 tab 所在槽位', () => {
    useTerminalLayoutStore.getState().dockTab('a', 2);
    expect(slotOf(useTerminalLayoutStore.getState().slots, 'a')).toBe(2);
    expect(slotOf(useTerminalLayoutStore.getState().slots, 'x')).toBe(-1);
  });
});

describe('grid helpers', () => {
  it('gridDimensions：左右两个 = 1 行 2 列', () => {
    expect(gridDimensions(['a', 'b', null, null])).toEqual({ rows: 1, cols: 2 });
  });
  it('gridDimensions：上下两个 = 2 行 1 列', () => {
    expect(gridDimensions(['a', null, 'b', null])).toEqual({ rows: 2, cols: 1 });
  });
  it('gridDimensions：四个 = 2 行 2 列', () => {
    expect(gridDimensions(['a', 'b', 'c', 'd'])).toEqual({ rows: 2, cols: 2 });
  });

  it('gridPosition：左右两个压缩到同一行', () => {
    const pos = gridPosition(['a', 'b', null, null]);
    expect(pos[0]).toEqual({ row: 0, col: 0 });
    expect(pos[1]).toEqual({ row: 0, col: 1 });
    expect(pos[2]).toEqual({ row: -1, col: -1 });
  });
  it('gridPosition：上下两个压缩到同一列', () => {
    const pos = gridPosition(['a', null, 'b', null]);
    expect(pos[0]).toEqual({ row: 0, col: 0 });
    expect(pos[2]).toEqual({ row: 1, col: 0 });
  });
});

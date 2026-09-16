/**
 * blocks — 命令块 store 测试。
 */
import { describe, it, expect } from 'vitest';
import { useBlockStore, selectBlocks } from '@features/terminal/stores/blocks';

const mk = (id: string): any =>
  ({ id, command: '', status: 'done', exitCode: 0, startedAt: 1, endedAt: 2, cwd: '', outputHtml: '', outputText: '' });

describe('blocks store', () => {
  it('addBlock / updateBlock / setBlocks / clearBlocks / dropTab', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    s.addBlock('t1', mk('b1'));
    s.addBlock('t1', mk('b2'));
    expect(useBlockStore.getState().byTab.t1).toHaveLength(2);
    s.updateBlock('t1', 'b1', { exitCode: 1 });
    expect(useBlockStore.getState().byTab.t1[0]!.exitCode).toBe(1);
    s.setBlocks('t1', [mk('b3')]);
    expect(useBlockStore.getState().byTab.t1).toHaveLength(1);
    s.clearBlocks('t1');
    expect(useBlockStore.getState().byTab.t1).toEqual([]);
    s.addBlock('t1', mk('b4'));
    s.dropTab('t1');
    expect(useBlockStore.getState().byTab.t1).toBeUndefined();
  });

  it('toggleBookmark / setBlockCollapsed / setAllCollapsed', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    s.addBlock('t1', mk('b1'));
    s.toggleBookmark('t1', 'b1');
    expect(useBlockStore.getState().byTab.t1[0]!.bookmarked).toBe(true);
    s.setBlockCollapsed('t1', 'b1', true);
    expect(useBlockStore.getState().byTab.t1[0]!.collapsed).toBe(true);
    s.addBlock('t1', mk('b2'));
    s.setAllCollapsed('t1', false);
    expect(useBlockStore.getState().byTab.t1.every((b) => !b.collapsed)).toBe(true);
  });

  it('不存在的 tab / block：各操作安全无副作用', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    s.addBlock('t1', mk('b1'));
    const before = useBlockStore.getState().byTab;
    s.updateBlock('nope', 'b1', { exitCode: 9 });
    s.toggleBookmark('nope', 'b1');
    s.toggleBookmark('t1', 'missing');
    s.setBlockCollapsed('nope', 'b1', true);
    s.setAllCollapsed('nope', true);
    s.dropTab('nope');
    expect(useBlockStore.getState().byTab).toEqual(before);
  });

  it('jumpToNextBookmark / jumpToPrevBookmark', () => {
    useBlockStore.setState({ byTab: {} });
    const s = useBlockStore.getState();
    expect(s.jumpToNextBookmark('nope')).toBeNull();
    s.addBlock('t1', mk('b1'));
    expect(s.jumpToNextBookmark('t1')).toBeNull();
    s.addBlock('t1', { ...mk('b2'), bookmarked: true });
    s.addBlock('t1', { ...mk('b3'), bookmarked: true });
    expect(s.jumpToNextBookmark('t1')).toBe('b2');
    expect(s.jumpToPrevBookmark('t1')).toBe('b3');
  });

  it('selectBlocks：缺 tab 返回稳定空引用', () => {
    useBlockStore.setState({ byTab: { t1: [mk('b1')] } });
    const state = useBlockStore.getState;
    const sel = selectBlocks('t1');
    expect(sel(state())).toHaveLength(1);
    const missing = selectBlocks('nope');
    expect(missing(state())).toEqual([]);
    expect(selectBlocks('nope')(state())).toBe(missing(state()));
  });
});

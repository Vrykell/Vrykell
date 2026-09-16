/**
 * ui — UI 状态 store 测试。
 */
import { describe, it, expect } from 'vitest';
import { useUiStore } from '@features/workspace/stores/ui';

describe('ui store', () => {
  it('splitPlacement 开关', () => {
    const s = useUiStore.getState();
    s.beginSplit(null);
    expect(useUiStore.getState().splitPlacement.open).toBe(true);
    useUiStore.getState().cancelSplit();
    expect(useUiStore.getState().splitPlacement.open).toBe(false);
  });
});

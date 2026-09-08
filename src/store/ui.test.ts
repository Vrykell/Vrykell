/**
 * ui — UI 状态 store 测试。
 */
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/ui';

describe('ui store', () => {
  it('splitPlacement 开关', () => {
    const s = useUiStore.getState();
    s.beginSplit(null);
    expect(useUiStore.getState().splitPlacement.open).toBe(true);
    useUiStore.getState().cancelSplit();
    expect(useUiStore.getState().splitPlacement.open).toBe(false);
  });
});

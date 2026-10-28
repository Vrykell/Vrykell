/**
 * ui — UI state store tests.
 */
import { describe, it, expect } from 'vitest';
import { useUiStore } from '@features/workspace/stores/ui';

describe('ui store', () => {
  it('toggles splitPlacement', () => {
    const s = useUiStore.getState();
    s.beginSplit(null);
    expect(useUiStore.getState().splitPlacement.open).toBe(true);
    useUiStore.getState().cancelSplit();
    expect(useUiStore.getState().splitPlacement.open).toBe(false);
  });
});

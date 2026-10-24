import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useFloatingPanelPosition } from '../hooks/useFloatingPanelPosition';

it('aligns an end-anchored menu using its measured width and follows its trigger', () => {
  const panel = document.createElement('div'); const trigger = document.createElement('button');
  const rect = vi.fn().mockReturnValue(new DOMRect(0, 0, 220, 60)); panel.getBoundingClientRect = rect;
  trigger.getBoundingClientRect = () => new DOMRect(600, 40, 28, 28);
  const ref = { current: panel }; const anchor = { x: 628, y: 72, trigger, align: 'end' as const };
  const { result } = renderHook(() => useFloatingPanelPosition(ref, anchor));
  expect(result.current).toMatchObject({ left: 408, top: 72 });
  rect.mockReturnValue(new DOMRect(0, 0, 320, 60));
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(result.current).toMatchObject({ left: 308, top: 72 });
});

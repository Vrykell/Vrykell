import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useNavigationButtonDrag } from '../hooks/useNavigationButtonDrag';
import { useDockStore } from '../stores/dock';
import { useNavigationDrag } from '../stores/navigationDrag';

const clicked = vi.fn();
let hit: Element | null;
const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
function Harness() {
  const start = useNavigationButtonDrag();
  return <>
    <nav data-dock-zone="left"><div data-dock-slot="tabs"><button onPointerDown={event => start(event, 'tabs')} onClick={clicked}>标签</button></div><div data-dock-slot="ssh">连接</div></nav>
    <nav data-dock-zone="right"><div data-dock-slot="chat">助手</div></nav>
  </>;
}
function pointer(type: string, x: number, y: number, target: HTMLElement | Window = window, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}
beforeEach(() => {
  vi.useFakeTimers();
  clicked.mockClear();
  useDockStore.setState({ leftZone: ['tabs', 'ssh'], rightZone: ['chat'], leftPanels: ['tabs'], rightPanels: [], collapsedPanels: [], panelWidths: {} });
  useNavigationDrag.getState().end();
  hit = null;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
});
afterEach(() => {
  cleanup();
  vi.runAllTimers();
  vi.useRealTimers();
  if (original) Object.defineProperty(document, 'elementFromPoint', original);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('navigation pointer gestures', () => {
  it('keeps ordinary clicks and tiny pointer movements from reordering', () => {
    render(<Harness />);
    const button = screen.getByText('标签');
    pointer('pointerdown', 10, 10, button);
    pointer('pointermove', 12, 11);
    pointer('pointerup', 12, 11);
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalledOnce();
    expect(useNavigationDrag.getState().id).toBeNull();
    expect(useDockStore.getState().leftZone).toEqual(['tabs', 'ssh']);
  });
  it('moves an open panel across sides, persists it, and suppresses the release click', () => {
    render(<Harness />);
    const button = screen.getByText('标签');
    hit = screen.getByText('助手');
    pointer('pointerdown', 10, 10, button);
    pointer('pointermove', 100, 10);
    expect(useNavigationDrag.getState().id).toBe('tabs');
    pointer('pointerup', 100, 10);
    fireEvent.click(button);
    expect(clicked).not.toHaveBeenCalled();
    expect(useDockStore.getState().rightPanels).toEqual(['tabs']);
    expect(JSON.parse(localStorage.getItem('dock-layout-v4')!).rightZone).toEqual(['chat', 'tabs']);
    expect(useNavigationDrag.getState().id).toBeNull();
  });
  it('uses vertical insertion positions for left-side reordering', () => {
    render(<Harness />);
    hit = screen.getByText('连接');
    pointer('pointerdown', 10, 10, screen.getByText('标签'));
    pointer('pointermove', 10, 100);
    pointer('pointerup', 10, 100);
    expect(useDockStore.getState().leftZone).toEqual(['ssh', 'tabs']);
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
  });
  it.each(['escape', 'blur', 'pointercancel', 'unmount'])('cancels on %s without saving a layout change', reason => {
    const { unmount } = render(<Harness />);
    const before = localStorage.getItem('dock-layout-v4');
    hit = screen.getByText('助手');
    pointer('pointerdown', 10, 10, screen.getByText('标签'));
    pointer('pointermove', 100, 10);
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (reason === 'unmount') unmount();
    else fireEvent(window, new Event(reason));
    pointer('pointerup', 100, 10);
    expect(useDockStore.getState().leftZone).toEqual(['tabs', 'ssh']);
    expect(useNavigationDrag.getState().id).toBeNull();
    expect(localStorage.getItem('dock-layout-v4')).toBe(before);
  });
  it('ignores secondary buttons and drops outside navigation', () => {
    render(<Harness />);
    const button = screen.getByText('标签');
    pointer('pointerdown', 10, 10, button, 2);
    pointer('pointermove', 100, 10);
    expect(useNavigationDrag.getState().id).toBeNull();
    pointer('pointerdown', 10, 10, button);
    pointer('pointermove', 100, 10);
    pointer('pointerup', 100, 10);
    expect(useDockStore.getState().leftZone).toEqual(['tabs', 'ssh']);
  });
  it('keeps the indicated insertion position when dropping inside the opened gap', () => {
    render(<Harness />);
    const area = document.querySelector('[data-dock-zone="right"]')!;
    const gap = document.createElement('div');
    gap.dataset.dockPlaceholder = '0';
    area.prepend(gap);
    hit = gap;
    pointer('pointerdown', 10, 10, screen.getByText('标签'));
    pointer('pointermove', 100, 10);
    pointer('pointermove', 101, 10);
    expect(useNavigationDrag.getState().target).toEqual({ side: 'right', index: 0 });
    pointer('pointerup', 101, 10);
    expect(useDockStore.getState().rightZone).toEqual(['tabs', 'chat']);
  });
});

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
function HeadingHarness() {
  const start = useNavigationButtonDrag();
  return <><div data-testid="heading" onPointerDown={event => start(event, 'tabs')}><span>Panel heading</span><button onClick={clicked}>Close</button></div><nav data-dock-zone="right"><div data-dock-slot="chat">Target</div></nav></>;
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
  it('uses the same drag gesture from a panel heading while leaving its close button independent', () => {
    render(<HeadingHarness />); hit = screen.getByText('Target');
    pointer('pointerdown', 10, 10, screen.getByRole('button', { name: 'Close' }));
    pointer('pointermove', 100, 10); pointer('pointerup', 100, 10);
    expect(useNavigationDrag.getState().id).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(clicked).toHaveBeenCalledOnce();
    pointer('pointerdown', 10, 10, screen.getByText('Panel heading'));
    pointer('pointermove', 100, 10);
    expect(useNavigationDrag.getState().id).toBe('tabs');
    pointer('pointerup', 100, 10);
    expect(useDockStore.getState().rightPanels).toEqual(['tabs']);
    expect(useDockStore.getState().rightZone).toEqual(['chat', 'tabs']);
  });
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
  it('opens a closed panel when dropped over a workspace edge and cancels the preview in the middle', () => {
    const { container } = render(<Harness />);
    const body = document.createElement('div');
    body.className = 'workspace-body'; container.append(body);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, top: 40, bottom: 700, width: 1000, height: 660 } as DOMRect);
    useDockStore.setState({ leftPanels: [] });
    pointer('pointerdown', 10, 10, screen.getByText('标签'));
    pointer('pointermove', 90, 200);
    expect(useNavigationDrag.getState().target).toMatchObject({ side: 'left', openPanel: true });
    pointer('pointermove', 500, 200);
    expect(useNavigationDrag.getState().target).toBeNull();
    pointer('pointerup', 960, 200);
    expect(useDockStore.getState().rightPanels).toEqual(['tabs']);
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

  it('accepts release across the whole preview width on either side', () => {
    const { container } = render(<Harness />);
    const body = document.createElement('div');
    body.className = 'workspace-body'; container.append(body);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, top: 40, bottom: 700, width: 1000, height: 660 } as DOMRect);
    useDockStore.setState({ leftPanels: [], panelWidths: { tabs: 280 } });
    pointer('pointerdown', 10, 10, screen.getByText('标签'));
    pointer('pointermove', 270, 200);
    expect(useNavigationDrag.getState().target).toMatchObject({ side: 'left', openPanel: true });
    pointer('pointermove', 725, 200);
    expect(useNavigationDrag.getState().target).toMatchObject({ side: 'right', openPanel: true });
    pointer('pointermove', 500, 200);
    expect(useNavigationDrag.getState().target).toBeNull();
    pointer('pointerup', 275, 200);
    expect(useDockStore.getState().leftPanels).toEqual(['tabs']);
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

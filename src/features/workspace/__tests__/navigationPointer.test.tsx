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
    <nav data-dock-zone="right">
      <div data-dock-slot="files"><button onPointerDown={event => start(event, 'files')} onClick={clicked}>Files</button></div>
      <div data-dock-slot="git">Changes</div><div data-dock-slot="chat">Assistant</div>
    </nav>
    <div data-testid="heading" onPointerDown={event => start(event, 'files')}><span>Panel heading</span><button onClick={clicked}>Close</button></div>
    <div className="workspace-body" data-testid="body" />
  </>;
}
function pointer(type: string, x: number, y: number, target: HTMLElement | Window = window, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, 'pointerId', { value: 1 }); fireEvent(target, event);
}
beforeEach(() => {
  vi.useFakeTimers(); clicked.mockClear();
  useDockStore.setState({ leftZone: [], rightZone: ['files', 'git', 'chat'], leftPanels: [], rightPanels: ['files'], collapsedPanels: [], panelWidths: {} });
  useNavigationDrag.getState().end(); hit = null;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
});
afterEach(() => {
  cleanup(); vi.runAllTimers(); vi.useRealTimers();
  if (original) Object.defineProperty(document, 'elementFromPoint', original); else Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('auxiliary navigation pointer gestures', () => {
  it('leaves ordinary clicks and tiny movements unchanged', () => {
    render(<Harness />);
    const button = screen.getByText('Files');
    pointer('pointerdown', 10, 10, button); pointer('pointermove', 12, 11); pointer('pointerup', 12, 11); fireEvent.click(button);
    expect(clicked).toHaveBeenCalledOnce();
    expect(useNavigationDrag.getState().id).toBeNull();
  });
  it('reorders horizontally without closing the panel or triggering a release click', () => {
    render(<Harness />); hit = screen.getByText('Assistant');
    const button = screen.getByText('Files');
    pointer('pointerdown', 10, 10, button); pointer('pointermove', 100, 10); pointer('pointerup', 100, 10); fireEvent.click(button);
    expect(clicked).not.toHaveBeenCalled();
    expect(useDockStore.getState().rightZone).toEqual(['git', 'chat', 'files']);
    expect(useDockStore.getState().rightPanels).toEqual(['files']);
    expect(JSON.parse(localStorage.getItem('dock-layout-v5')!).rightZone).toEqual(['git', 'chat', 'files']);
  });
  it('accepts a panel heading while keeping its close button independent', () => {
    render(<Harness />); hit = screen.getByText('Assistant');
    pointer('pointerdown', 10, 10, screen.getByRole('button', { name: 'Close' })); pointer('pointermove', 100, 10); pointer('pointerup', 100, 10);
    expect(useNavigationDrag.getState().id).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(clicked).toHaveBeenCalledOnce();
    pointer('pointerdown', 10, 10, screen.getByText('Panel heading')); pointer('pointermove', 100, 10); pointer('pointerup', 100, 10);
    expect(useDockStore.getState().rightZone).toEqual(['git', 'chat', 'files']);
  });
  it.each(['escape', 'blur', 'pointercancel', 'unmount'])('cancels on %s without saving', reason => {
    const { unmount } = render(<Harness />);
    const saved = localStorage.getItem('dock-layout-v5'); hit = screen.getByText('Assistant');
    pointer('pointerdown', 10, 10, screen.getByText('Files')); pointer('pointermove', 100, 10);
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (reason === 'unmount') unmount(); else fireEvent(window, new Event(reason));
    pointer('pointerup', 100, 10);
    expect(useDockStore.getState().rightZone).toEqual(['files', 'git', 'chat']);
    expect(useNavigationDrag.getState().id).toBeNull();
    expect(localStorage.getItem('dock-layout-v5')).toBe(saved);
  });
  it('offers only the right content edge and uses the full preview as the release target', () => {
    render(<Harness />);
    vi.spyOn(screen.getByTestId('body'), 'getBoundingClientRect').mockReturnValue({ left: 208, right: 1240, top: 76, bottom: 800, width: 1032, height: 724 } as DOMRect);
    useDockStore.setState({ rightPanels: [], panelWidths: { files: 280 } });
    pointer('pointerdown', 10, 10, screen.getByText('Files'));
    pointer('pointermove', 250, 200); expect(useNavigationDrag.getState().target).toBeNull();
    pointer('pointermove', 970, 200); expect(useNavigationDrag.getState().target).toMatchObject({ side: 'right', openPanel: true });
    pointer('pointermove', 700, 200); expect(useNavigationDrag.getState().target).toBeNull();
    pointer('pointerup', 970, 200); expect(useDockStore.getState().rightPanels).toEqual(['files']);
    expect(useDockStore.getState().leftPanels).toEqual([]);
  });
  it('ignores secondary buttons and invalid release targets', () => {
    render(<Harness />); const button = screen.getByText('Files');
    pointer('pointerdown', 10, 10, button, 2); pointer('pointermove', 100, 10);
    expect(useNavigationDrag.getState().id).toBeNull();
    pointer('pointerdown', 10, 10, button); pointer('pointermove', 100, 10); pointer('pointerup', 100, 10);
    expect(useDockStore.getState().rightZone).toEqual(['files', 'git', 'chat']);
  });
  it('keeps the indicated insertion slot when released inside the placeholder', () => {
    render(<Harness />);
    const area = document.querySelector('[data-dock-zone="right"]')!;
    const gap = document.createElement('div'); gap.dataset.dockPlaceholder = '0'; area.prepend(gap); hit = gap;
    pointer('pointerdown', 10, 10, screen.getByText('Files')); pointer('pointermove', 100, 10);
    expect(useNavigationDrag.getState().target).toEqual({ side: 'right', index: 0 });
    pointer('pointerup', 100, 10); expect(useDockStore.getState().rightZone).toEqual(['files', 'git', 'chat']);
  });
});

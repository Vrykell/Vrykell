import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveDragLayer, PlacementOverlay } from '../components/TerminalPlacementOverlay';
import { useToastStore } from '@ui/Toast';
import { useDockDragStore } from '@features/workspace';
import { leaf, type DropTarget, type TerminalSpec, type WindowLayout } from '@features/workspace/model/windowLayout';

const viewport = {
  x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800,
  toJSON: () => ({}),
} as DOMRect;

// 单终端分裂的四个半屏落点（row first/second = 左/右，col first/second = 上/下）。
const left: DropTarget = { leafId: 'a', dir: 'row', position: 'first', rect: { x: 0, y: 0, w: 0.5, h: 1 } };
const right: DropTarget = { leafId: 'a', dir: 'row', position: 'second', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } };
const above: DropTarget = { leafId: 'a', dir: 'col', position: 'first', rect: { x: 0, y: 0, w: 1, h: 0.5 } };
const below: DropTarget = { leafId: 'a', dir: 'col', position: 'second', rect: { x: 0, y: 0.5, w: 1, h: 0.5 } };

const specA: TerminalSpec = { id: 'a', kind: 'local', shellType: 'powershell' };
const specB: TerminalSpec = { id: 'b', kind: 'local', shellType: 'powershell' };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(viewport);
  useToastStore.setState({ toasts: [], timers: {} });
  useDockDragStore.setState({ draggingTerminalId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlacementOverlay', () => {
  it('shows the supplied split action inside the hovered target', () => {
    const pick = vi.fn();
    render(<PlacementOverlay targets={[left, right]} hint="Click here to split the terminal" onPick={pick} onCancel={vi.fn()} />);
    fireEvent.mouseMove(screen.getByTestId('placement-overlay'), { clientX: 960, clientY: 400 });
    expect(screen.getByTestId('placement-zone-1')).toHaveTextContent('Click here to split the terminal');
    fireEvent.click(screen.getByTestId('placement-overlay'), { clientX: 960, clientY: 400 });
    expect(pick).toHaveBeenCalledWith(right);
  });
  it('previews only the slot under the pointer, without labels', () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<PlacementOverlay targets={[left, right, above, below]} onPick={onPick} onCancel={onCancel} />);
    const overlay = screen.getByTestId('placement-overlay');

    // 指针不在任何落点上时没有预览，也没有十字准星式的全屏描边。
    expect(screen.queryAllByTestId(/^placement-zone-/)).toHaveLength(0);

    fireEvent.mouseMove(overlay, { clientX: 40, clientY: 400 });
    expect(screen.getAllByTestId(/^placement-zone-/)).toHaveLength(1);
    expect(screen.getByTestId('placement-zone-0')).toBeEmptyDOMElement();

    fireEvent.mouseMove(overlay, { clientX: 960, clientY: 400 });
    expect(screen.getByTestId('placement-zone-1')).toBeEmptyDOMElement();

    fireEvent.mouseMove(overlay, { clientX: 250, clientY: 40 });
    expect(screen.getByTestId('placement-zone-2')).toBeEmptyDOMElement();

    fireEvent.mouseMove(overlay, { clientX: 750, clientY: 790 });
    expect(screen.getByTestId('placement-zone-3')).toBeEmptyDOMElement();

    // 离开覆盖层后预览消失，回到初始的简洁状态。
    fireEvent.mouseLeave(overlay);
    expect(screen.queryAllByTestId(/^placement-zone-/)).toHaveLength(0);

    fireEvent.click(overlay, { clientX: 960, clientY: 400 });
    expect(onPick).toHaveBeenCalledWith(right);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ends on Escape, on a press outside the layout area and when the window loses focus', () => {
    const onCancel = vi.fn();
    const { unmount } = render(<PlacementOverlay targets={[left]} onPick={() => {}} onCancel={onCancel} />);
    const overlay = screen.getByTestId('placement-overlay');
    expect(overlay).toBeVisible();

    // 覆盖层内的按下是正常选择，不算失焦。
    act(() => { overlay.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onCancel).not.toHaveBeenCalled();

    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);

    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(onCancel).toHaveBeenCalledTimes(3);

    // 卸载后不再响应焦点变化。
    unmount();
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('cancels a click outside every slot and reports the empty case through a single toast', () => {
    const onCancel = vi.fn();
    const { unmount } = render(<PlacementOverlay targets={[left]} onPick={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('placement-overlay'), { clientX: 750, clientY: 400 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();

    // StrictMode 重放挂载副作用时，满员提示也只出现一次。
    const onEmptyCancel = vi.fn();
    render(
      <StrictMode>
        <PlacementOverlay targets={[]} onPick={() => {}} onCancel={onEmptyCancel} />
      </StrictMode>,
    );
    expect(useToastStore.getState().toasts.filter((toast) => toast.message === '最多 4 个终端')).toHaveLength(1);
    expect(onEmptyCancel).toHaveBeenCalled();
  });
});

describe('MoveDragLayer', () => {
  const layout: WindowLayout = {
    type: 'split', dir: 'row', ratio: 0.5, first: leaf(specA), second: leaf(specB),
  };

  it('previews the release slot under the pointer and commits it on mouse up', () => {
    useDockDragStore.setState({ draggingTerminalId: 'b' });
    const onCommit = vi.fn();
    render(<MoveDragLayer layout={layout} draggingId="b" onCommit={onCommit} />);

    fireEvent.mouseMove(document.body, { clientX: 40, clientY: 400 });
    expect(screen.getByTestId('move-placement-zone-0')).toBeEmptyDOMElement();

    fireEvent.mouseUp(document.body);
    expect(onCommit).toHaveBeenCalledWith('b', expect.objectContaining({ dir: 'row', position: 'first' }));
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();
  });

  it('cancels the drag on Escape and when the window loses focus', () => {
    useDockDragStore.setState({ draggingTerminalId: 'b' });
    render(<MoveDragLayer layout={layout} draggingId="b" onCommit={() => {}} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();

    useDockDragStore.setState({ draggingTerminalId: 'b' });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(useDockDragStore.getState().draggingTerminalId).toBeNull();
  });

  it('renders no layer when the dragged pane is the only terminal', () => {
    const { container } = render(<MoveDragLayer layout={leaf(specA)} draggingId="a" onCommit={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

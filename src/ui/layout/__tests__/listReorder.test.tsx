import { Fragment } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ListReorderPlaceholder,
  ListReorderPreview,
  ListReorderZonePlaceholder,
  useListReorder,
  useListReorderDrag,
  type ListReorderDrag,
  type ListReorderTarget,
} from '@ui/layout/listReorder';

const ROW_HEIGHT = 40;
const ROW_GAP = 2;

function rowRect(top: number): DOMRect {
  return {
    top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT,
    left: 0, right: 120, width: 120, x: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function DemoRow({ id, start, measureContainer = false }: {
  id: string;
  measureContainer?: boolean;
  start: (event: React.PointerEvent<HTMLElement>, item: { id: string; kind: string }) => void;
}) {
  const dragging = useListReorder((state) => state.drag?.id === id);
  return (
    <div
      data-testid={`row-${id}`}
      data-reorder-item={id}
      data-reorder-kind="demo"
      data-reorder-measure={measureContainer ? 'container' : undefined}
      data-reorder-dragging={dragging ? 'true' : undefined}
      onPointerDown={(event) => start(event, { id, kind: 'demo' })}
    >
      {id}
      <span data-testid={`opt-out-${id}`} data-no-drag>opt</span>
      <button data-testid={`handle-${id}`} data-reorder-handle>drag</button>
    </div>
  );
}

function Harness({ onDrop, listId = 'demo', axis, grouped = false, wholeGroups = false }: {
  onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void;
  listId?: string;
  axis?: 'vertical' | 'horizontal';
  grouped?: boolean;
  wholeGroups?: boolean;
}) {
  const start = useListReorderDrag({ listId, onDrop, axis, grouped });
  return (
    <div data-reorder-list={listId} data-reorder-zone={grouped ? 'members' : undefined} data-reorder-kind={grouped ? 'demo' : undefined}>
      {['a', 'b', 'c'].map((id) => (
        <Fragment key={id}>
          <ListReorderPlaceholder listId={listId} itemId={id} />
          {wholeGroups ? <div data-reorder-container><DemoRow id={id} start={start} measureContainer /></div> : <DemoRow id={id} start={start} />}
        </Fragment>
      ))}
      <ListReorderPlaceholder listId={listId} itemId="c" after />
    </div>
  );
}

function GroupedHarness({ onDrop }: { onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void }) {
  const start = useListReorderDrag({ listId: 'groups', onDrop, axis: 'horizontal', grouped: true });
  return <div data-reorder-list="groups">
    <div data-reorder-zone="filled" data-reorder-kind="demo"><DemoRow id="a" start={start} /></div>
    <div data-testid="empty-zone" data-reorder-zone="empty" data-reorder-kind="demo"><ListReorderZonePlaceholder listId="groups" zoneId="empty" /></div>
  </div>;
}

/** Terminal-strip shaped list: one group (label + members) followed by a loose tab and an empty tail. */
function StripHarness({ onDrop, collapsed = false }: {
  onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void;
  collapsed?: boolean;
}) {
  const start = useListReorderDrag({ listId: 'strip', axis: 'horizontal', grouped: true, endZoneId: 'ungrouped', onDrop,
    accepts: (dragKind, itemKind) => dragKind === 'group' ? itemKind === 'group' || itemKind === 'loose-tab'
      : dragKind === 'loose-tab' ? itemKind === 'group' || itemKind === 'loose-tab' || itemKind === 'tab'
        : itemKind === 'loose-tab' || itemKind === 'group' || (dragKind === 'tab' && itemKind === 'tab') });
  return <div data-testid="strip" data-reorder-list="strip">
    <div data-testid="group-container" data-reorder-container>
      <div data-testid="group-zone" data-reorder-zone="g1" data-reorder-kind="tab">
        <div data-testid="label" data-reorder-item="g1" data-reorder-kind="group" data-reorder-measure="container"
          onPointerDown={event => start(event, { id: 'g1', kind: 'group' })}>G1</div>
        {!collapsed && <>
          <div data-testid="m1" data-reorder-item="m1" data-reorder-kind="tab" onPointerDown={event => start(event, { id: 'm1', kind: 'tab' })}>M1</div>
          <div data-testid="m2" data-reorder-item="m2" data-reorder-kind="tab" onPointerDown={event => start(event, { id: 'm2', kind: 'tab' })}>M2</div>
        </>}
      </div>
    </div>
    <div data-testid="loose" data-reorder-item="loose" data-reorder-kind="loose-tab" onPointerDown={event => start(event, { id: 'loose', kind: 'loose-tab' })}>C</div>
    <div data-testid="tail" data-reorder-zone="ungrouped" data-reorder-kind="loose-tab" />
  </div>;
}

/** Label 0-60, members 60-140 / 140-220, loose tab 220-300 inside a 300 wide strip. */
function stripRect(left: number, width: number): DOMRect {
  return { ...rowRect(0), left, x: left, right: left + width, width };
}

function mockStripRects() {
  vi.spyOn(screen.getByTestId('strip'), 'getBoundingClientRect').mockReturnValue(stripRect(0, 300));
  const rects: Record<string, [number, number]> = { label: [0, 60], m1: [60, 80], m2: [140, 80], loose: [220, 80] };
  for (const [testId, [left, width]] of Object.entries(rects)) {
    const element = screen.queryByTestId(testId);
    if (element) vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(stripRect(left, width));
  }
  vi.spyOn(screen.getByTestId('group-container'), 'getBoundingClientRect').mockReturnValue(stripRect(0, 220));
}

/** Pointer zones follow x: at or past `tailFrom` is the empty tail, otherwise the group container. */
function mockStripHitTesting(tailFrom = 200) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((x: number) => x > tailFrom ? screen.getByTestId('tail') : screen.getByTestId('group-zone')),
  });
}

/** Start dragging row-a and move the pointer to the given viewport y. */
function dragTo(y: number) {
  const rows = ['a', 'b', 'c'].map((id) => screen.getByTestId(`row-${id}`));
  rows.forEach((row, index) => {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rowRect(index * (ROW_HEIGHT + ROW_GAP)));
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => rows[1]) });
  fireEvent.pointerDown(rows[0]!, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: y });
  return rows;
}

function horizontalScrollHarness(direction: 'left' | 'right') {
  const onDrop = vi.fn(); const view = render(<Harness onDrop={onDrop} axis="horizontal" />);
  const rows = ['a', 'b', 'c'].map(id => screen.getByTestId(`row-${id}`));
  const list = rows[0]!.parentElement!;
  let offset = direction === 'left' ? 180 : 0;
  Object.defineProperties(list, {
    clientWidth: { configurable: true, value: 180 },
    scrollWidth: { configurable: true, value: 360 },
    scrollLeft: { configurable: true, get: () => offset, set: (value: number) => { offset = Math.max(0, Math.min(180, value)); } },
  });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ ...rowRect(0), width: 180, right: 180 });
  rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({
    ...rowRect(0), x: index * 120 - offset, left: index * 120 - offset, right: (index + 1) * 120 - offset,
  })));
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0; let time = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const advance = (count = 1) => act(() => {
    for (let index = 0; index < count; index++) {
      time += 16; const pending = Array.from(frames.values()); frames.clear(); pending.forEach(callback => callback(time));
    }
  });
  const source = rows[direction === 'left' ? 2 : 0]!;
  const grab = direction === 'left' ? 70 : 10; const destination = direction === 'left' ? 4 : 176;
  fireEvent.pointerDown(source, { pointerId: 1, button: 0, isPrimary: true, clientX: grab, clientY: 10 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: destination, clientY: 10 });
  return { ...view, onDrop, list, frames, advance, destination };
}

describe('list reorder', () => {
  beforeEach(() => {
    useListReorder.getState().end();
  });
  it('moves horizontal items into an empty group with a full-width stable placeholder', () => {
    const onDrop = vi.fn(); render(<GroupedHarness onDrop={onDrop} />);
    const row = screen.getByTestId('row-a'); const zone = screen.getByTestId('empty-zone');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rowRect(0));
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => zone.querySelector('[data-reorder-placeholder]') ?? zone) });
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ zoneId: 'empty' });
    expect(zone.firstChild).toHaveStyle({ width: '120px', height: '40px' });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 210, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { zoneId: 'empty' });
  });
  it('uses horizontal midpoints and preserves the dragged tab width', () => {
    const parked = document.createElement('div'); parked.dataset.reorderList = 'demo'; parked.hidden = true; document.body.prepend(parked);
    const onDrop = vi.fn(); render(<Harness onDrop={onDrop} axis="horizontal" />);
    const rows = ['a', 'b', 'c'].map(id => screen.getByTestId(`row-${id}`));
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ ...rowRect(0), x: index * 120, left: index * 120, right: (index + 1) * 120 }));
    vi.spyOn(rows[0]!.parentElement!, 'getBoundingClientRect').mockReturnValue({ ...rowRect(0), width: 360, right: 360 });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => rows[1]) });
    fireEvent.pointerDown(rows[0]!, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'c', after: true });
    expect(useListReorder.getState().drag).toMatchObject({ width: 120 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { itemId: 'c', after: true });
    parked.remove();
  });

  it.each([['left', false], ['right', false], ['left', true], ['right', true]] as const)('exchanges unequal horizontal items toward the %s with grouped=%s while the pointer stays over the source gap', (direction, grouped) => {
    const onDrop = vi.fn(); render(<Harness onDrop={onDrop} axis="horizontal" grouped={grouped} />);
    const rows = ['a', 'b', 'c'].map(id => screen.getByTestId(`row-${id}`));
    const lefts = [0, 80, 320]; const widths = [80, 240, 100];
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      ...rowRect(0), x: lefts[index]!, left: lefts[index]!, right: lefts[index]! + widths[index]!, width: widths[index]!,
    }));
    vi.spyOn(rows[0]!.parentElement!, 'getBoundingClientRect').mockReturnValue({ ...rowRect(0), width: 420, right: 420 });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => document.querySelector('[data-reorder-placeholder]') ?? rows[1]) });
    const grab = direction === 'left' ? 300 : 100;
    fireEvent.pointerDown(rows[1]!, { pointerId: 1, button: 0, isPrimary: true, clientX: grab, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: grab + (direction === 'left' ? -8 : 8), clientY: 10 });
    const destination = direction === 'left' ? 256 : 154;
    fireEvent.pointerMove(window, { pointerId: 1, clientX: destination, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: direction === 'left' ? 'a' : 'c', after: direction === 'right' });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: grab, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'c', after: false });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: destination, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: destination, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), { itemId: direction === 'left' ? 'a' : 'c', after: direction === 'right' });
  });

  it('inserts a loose tab before a group member when the dragged leading edge reaches it', () => {
    const onDrop = vi.fn(); render(<StripHarness onDrop={onDrop} />);
    mockStripRects(); mockStripHitTesting();
    const loose = screen.getByTestId('loose');
    fireEvent.pointerDown(loose, { pointerId: 1, button: 0, isPrimary: true, clientX: 260, clientY: 10 });
    // Leading edge at 70: the first member's left half, so the tab joins as its first member.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 110, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'm1', after: false });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 110, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'loose' }), { itemId: 'm1', after: false });
  });

  it('keeps a tab inside the group until its leading edge passes the last member', () => {
    const onDrop = vi.fn(); render(<StripHarness onDrop={onDrop} />);
    mockStripRects(); mockStripHitTesting(295);
    const loose = screen.getByTestId('loose');
    fireEvent.pointerDown(loose, { pointerId: 1, button: 0, isPrimary: true, clientX: 260, clientY: 10 });
    // Leading edge at 210: past the last member's midpoint but still inside the group.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 250, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'm2', after: true });
    // Leading edge at the group's right edge: the tab leaves the group for the empty tail.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 265, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ zoneId: 'ungrouped' });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 250, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 250, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'loose' }), { itemId: 'm2', after: true });
  });

  it('drops a tab after a collapsed group unless the pointer dwells on its label', () => {
    vi.useFakeTimers();
    try {
      const onDrop = vi.fn(); render(<StripHarness onDrop={onDrop} collapsed />);
      mockStripRects(); mockStripHitTesting();
      const loose = screen.getByTestId('loose');
      fireEvent.pointerDown(loose, { pointerId: 1, button: 0, isPrimary: true, clientX: 260, clientY: 10 });
      // Over the label: the default is still "after the group" while the dwell is pending.
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 110, clientY: 10 });
      expect(useListReorder.getState().target).toEqual({ itemId: 'g1', after: true });
      expect(useListReorder.getState().dwellZoneId).toBeNull();
      // Leaving the label cancels the pending dwell and falls back to the empty tail.
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 260, clientY: 10 });
      expect(useListReorder.getState().target).toEqual({ zoneId: 'ungrouped' });
      // Resting on the label fires the dwell and joins the group.
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 110, clientY: 10 });
      act(() => { vi.advanceTimersByTime(400); });
      expect(useListReorder.getState().dwellZoneId).toBe('g1');
      expect(useListReorder.getState().target).toEqual({ zoneId: 'g1' });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 110, clientY: 10 });
      expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'loose' }), { zoneId: 'g1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves a member tab out of its group and never nests a dragged group', () => {
    const onDrop = vi.fn(); render(<StripHarness onDrop={onDrop} />);
    mockStripRects(); mockStripHitTesting();
    const m1 = screen.getByTestId('m1');
    fireEvent.pointerDown(m1, { pointerId: 1, button: 0, isPrimary: true, clientX: 100, clientY: 10 });
    // Leading edge at 160: between the second member and the loose tab, so the tab leaves the group.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'loose', after: false });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), { itemId: 'loose', after: false });

    // Dragging the group itself over the loose tab places it beside the tab, never inside anything.
    onDrop.mockClear();
    const label = screen.getByTestId('label');
    fireEvent.pointerDown(label, { pointerId: 2, button: 0, isPrimary: true, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 60, clientY: 10 });
    expect(useListReorder.getState().target).toEqual({ itemId: 'loose', after: false });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 60, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', kind: 'group' }), { itemId: 'loose', after: false });
  });

  it.each(['left', 'right'] as const)('keeps scrolling at the %s edge with a stationary pointer and updates the drop slot', direction => {
    const { list, frames, advance, onDrop, destination } = horizontalScrollHarness(direction);
    const initial = list.scrollLeft;
    advance(3);
    expect(Math.sign(list.scrollLeft - initial)).toBe(direction === 'left' ? -1 : 1);
    advance(30);
    expect(list.scrollLeft).toBe(direction === 'left' ? 0 : 180);
    expect(frames.size).toBe(0);
    const target = { itemId: direction === 'left' ? 'a' : 'c', after: direction === 'right' };
    expect(useListReorder.getState().target).toEqual(target);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: destination, clientY: 10 });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ id: direction === 'left' ? 'c' : 'a' }), target);
  });

  it('stops scrolling away from the edge and can resume in either direction', () => {
    const { list, frames, advance } = horizontalScrollHarness('right');
    advance(5);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 10 });
    const stopped = list.scrollLeft;
    advance(3);
    expect(list.scrollLeft).toBe(stopped); expect(frames.size).toBe(0);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 176, clientY: 10 });
    advance(3); expect(list.scrollLeft).toBeGreaterThan(stopped);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 10 });
    advance(30); expect(list.scrollLeft).toBe(0); expect(frames.size).toBe(0);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
  });

  it.each(['drop', 'escape', 'pointercancel', 'blur', 'unmount'])('stops edge scrolling on %s', end => {
    const { list, frames, advance, unmount, onDrop, destination } = horizontalScrollHarness('right');
    advance(3);
    expect(frames.size).toBe(1);
    if (end === 'drop') fireEvent.pointerUp(window, { pointerId: 1, clientX: destination, clientY: 10 });
    else if (end === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (end === 'unmount') unmount();
    else fireEvent(window, new Event(end));
    const stopped = list.scrollLeft;
    expect(frames.size).toBe(0);
    advance(5); expect(list.scrollLeft).toBe(stopped);
    if (end === 'escape') fireEvent.pointerUp(window, { pointerId: 1, clientX: destination, clientY: 10 });
    expect(onDrop).toHaveBeenCalledTimes(end === 'drop' ? 1 : 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useListReorder.getState().end();
  });

  it('hides the dragged row and marks the boundary with a placeholder', () => {
    render(<Harness onDrop={vi.fn()} />);
    const rows = dragTo(45);

    expect(rows[0]).toHaveAttribute('data-reorder-dragging', 'true');
    expect(useListReorder.getState().target).toEqual({ itemId: 'b', after: false });
    expect(document.querySelector('[data-reorder-placeholder="b"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-reorder-placeholder="b"]')!.style.height).toBe('40px');
  });

  it('resolves the end of the list past the last row and drops there', () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    dragTo(110);

    expect(useListReorder.getState().target).toEqual({ itemId: 'c', after: true });
    expect(document.querySelector('[data-reorder-placeholder="c"]')).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 110 });

    expect(onDrop).toHaveBeenCalledWith(
      { listId: 'demo', id: 'a', kind: 'demo', height: 40 },
      { itemId: 'c', after: true },
    );
    expect(useListReorder.getState().drag).toBeNull();
  });

  it('cancels the drag on Escape without dropping', () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const rows = dragTo(45);

    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(useListReorder.getState().drag).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 45 });
    expect(onDrop).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveAttribute('data-reorder-dragging');
  });

  it('renders the floating preview only for the list being dragged', () => {
    render(
      <>
        <Harness onDrop={vi.fn()} />
        <ListReorderPreview listId="demo">{(drag) => <span data-testid="preview-demo">{drag.id}</span>}</ListReorderPreview>
        <ListReorderPreview listId="other">{() => <span data-testid="preview-other">other</span>}</ListReorderPreview>
      </>,
    );
    dragTo(45);

    expect(screen.getByTestId('preview-demo').textContent).toBe('a');
    expect(screen.queryByTestId('preview-other')).toBeNull();
  });

  it('moves the preview on the compositor without rerendering its content for each pointer update', () => {
    const content = vi.fn((drag: ListReorderDrag) => <span>{drag.id}</span>);
    render(<ListReorderPreview listId="demo">{content}</ListReorderPreview>);
    act(() => useListReorder.getState().start({ listId: 'demo', id: 'a', kind: 'demo' }, { x: 10, y: 20 }));
    const preview = document.querySelector<HTMLElement>('[data-reorder-preview]')!;
    for (let index = 0; index < 20; index += 1) act(() => useListReorder.getState().movePointer(index + 10, index + 20));
    expect(content).toHaveBeenCalledOnce();
    expect(preview.style.transform).toBe('translate3d(29px, 39px, 0) translate(-50%, -50%)');
    act(() => useListReorder.getState().end());
    expect(document.querySelector('[data-reorder-preview]')).toBeNull();
  });

  it('ignores pointer downs on opt-out nodes', () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const optOut = screen.getByTestId('opt-out-a');
    fireEvent.pointerDown(optOut, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 70 });

    expect(useListReorder.getState().drag).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('resolves list ids containing quoted project scopes', () => {
    const listId = 'commands:["local","D:/project"]';
    render(<Harness listId={listId} onDrop={vi.fn()} />);
    dragTo(45);
    expect(useListReorder.getState().drag?.listId).toBe(listId);
    expect(useListReorder.getState().target).toEqual({ itemId: 'b', after: false });
  });

  it('skips hidden rows when resolving a drop', () => {
    render(<Harness onDrop={vi.fn()} />);
    screen.getByTestId('row-b').hidden = true;
    dragTo(45);
    expect(useListReorder.getState().target).toEqual({ itemId: 'c', after: false });
  });

  it('captures an opt-in button handle without redirecting its normal click to the row', () => {
    render(<Harness onDrop={vi.fn()} />);
    const button = screen.getByTestId('handle-a');
    const capture = vi.fn();
    Object.defineProperty(button, 'setPointerCapture', { configurable: true, value: capture });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    expect(capture).toHaveBeenCalledWith(1);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useListReorder.getState().drag).toBeNull();
  });
});

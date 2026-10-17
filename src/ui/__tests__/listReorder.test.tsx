import { Fragment } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ListReorderPlaceholder,
  ListReorderPreview,
  useListReorder,
  useListReorderDrag,
  type ListReorderDrag,
  type ListReorderTarget,
} from '../listReorder';

const ROW_HEIGHT = 40;
const ROW_GAP = 2;

function rowRect(top: number): DOMRect {
  return {
    top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT,
    left: 0, right: 120, width: 120, x: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function DemoRow({ id, start }: {
  id: string;
  start: (event: React.PointerEvent<HTMLElement>, item: { id: string; kind: string }) => void;
}) {
  const dragging = useListReorder((state) => state.drag?.id === id);
  return (
    <div
      data-testid={`row-${id}`}
      data-reorder-item={id}
      data-reorder-kind="demo"
      data-reorder-dragging={dragging ? 'true' : undefined}
      onPointerDown={(event) => start(event, { id, kind: 'demo' })}
    >
      {id}
      <span data-testid={`opt-out-${id}`} data-no-drag>opt</span>
      <button data-testid={`handle-${id}`} data-reorder-handle>drag</button>
    </div>
  );
}

function Harness({ onDrop, listId = 'demo' }: {
  onDrop: (drag: ListReorderDrag, target: ListReorderTarget | null) => void;
  listId?: string;
}) {
  const start = useListReorderDrag({ listId, onDrop });
  return (
    <div data-reorder-list={listId}>
      {['a', 'b', 'c'].map((id) => (
        <Fragment key={id}>
          <ListReorderPlaceholder listId={listId} itemId={id} />
          <DemoRow id={id} start={start} />
        </Fragment>
      ))}
      <ListReorderPlaceholder listId={listId} itemId="c" after />
    </div>
  );
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

describe('list reorder', () => {
  beforeEach(() => {
    useListReorder.getState().end();
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

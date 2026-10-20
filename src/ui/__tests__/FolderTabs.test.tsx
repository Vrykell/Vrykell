import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FolderTabs, { type FolderTab } from '../FolderTabs';
import { useListReorder } from '../listReorder';

const items: FolderTab[] = ['first', 'second'].map(id => ({ id, label: id, icon: null, tip: id, closeLabel: `Close ${id}` }));

function setup() {
  const onSelect = vi.fn(); const onClose = vi.fn(); const onMove = vi.fn();
  render(<FolderTabs items={items} selected="first" label="Open documents" toolbar={null} onSelect={onSelect} onClose={onClose} onMove={onMove} />);
  const tabs = screen.getAllByRole('tab');
  tabs.forEach((tab, index) => {
    vi.spyOn(tab.closest('.folder-tab')!, 'getBoundingClientRect').mockReturnValue({
      x: index * 120, y: 0, left: index * 120, right: (index + 1) * 120, top: 0, bottom: 34, width: 120, height: 34, toJSON: () => ({}),
    });
  });
  vi.spyOn(screen.getByRole('tablist'), 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, right: 240, top: 0, bottom: 34, width: 240, height: 34, toJSON: () => ({}),
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => tabs[1]) });
  return { tabs, onSelect, onClose, onMove };
}

function dragFirst(tab: HTMLElement) {
  fireEvent.pointerDown(tab, { pointerId: 1, button: 0, isPrimary: true, clientX: 20, clientY: 14 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 220, clientY: 14 });
}

afterEach(() => { useListReorder.getState().end(); vi.restoreAllMocks(); });

it('reorders the selected first document without removing other tabs or changing selection', () => {
  const { tabs, onSelect, onMove } = setup();
  dragFirst(tabs[0]!);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(tabs[1]!.closest('.folder-tab')).not.toHaveAttribute('data-reorder-dragging');
  const preview = document.querySelector('[data-reorder-preview="item"]');
  expect(preview).toHaveTextContent('first');
  expect(preview).toHaveStyle({ width: '120px', height: '34px', top: '0px' });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 14 });
  expect(onMove).toHaveBeenCalledWith('first', 'second', true);
  expect(onSelect).not.toHaveBeenCalled();
});

it('cancels a selected document drag without changing order or selection', () => {
  const { tabs, onSelect, onMove } = setup();
  dragFirst(tabs[0]!);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 14 });
  expect(onMove).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['first', 'second']);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
});

it('keeps close buttons independent of document dragging', () => {
  const { onClose, onMove } = setup();
  const close = screen.getByRole('button', { name: 'Close first' });
  fireEvent.pointerDown(close, { pointerId: 1, button: 0, isPrimary: true, clientX: 20, clientY: 14 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 220, clientY: 14 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 14 });
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledWith('first'); expect(onMove).not.toHaveBeenCalled();
  expect(useListReorder.getState().drag).toBeNull();
});

it('selects a document on primary pointer press before movement or release', () => {
  const { tabs, onSelect } = setup();
  fireEvent.pointerDown(tabs[1]!, { pointerId: 1, button: 0, isPrimary: true, clientX: 140, clientY: 14 });
  expect(onSelect).toHaveBeenCalledWith('second');
  expect(useListReorder.getState().drag).toBeNull();
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 140, clientY: 14 });
});

it('does not switch documents for secondary presses or close buttons', () => {
  const { tabs, onSelect } = setup();
  fireEvent.pointerDown(tabs[1]!, { pointerId: 1, button: 2, isPrimary: true });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Close second' }), { pointerId: 2, button: 0, isPrimary: true });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { pointerId: 2 });
});

it('retains document activation without pointer events', () => {
  const { tabs, onSelect } = setup();
  fireEvent.click(tabs[1]!, { detail: 0 });
  expect(onSelect).toHaveBeenCalledWith('second');
});

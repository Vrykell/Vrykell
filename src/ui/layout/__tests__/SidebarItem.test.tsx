import { act, fireEvent, render, screen } from '@testing-library/react';
import { useListReorder } from '@ui/layout/listReorder';
import { describe, expect, it, vi } from 'vitest';
import SidebarItem from '@ui/layout/sidebarItem';

function renderItem(overrides: Partial<Parameters<typeof SidebarItem>[0]> = {}) {
  const onAction = vi.fn();
  const onClick = vi.fn();
  render(
    <SidebarItem
      active={false}
      icon={<span>icon</span>}
      title="会话一"
      tooltip="会话提示"
      onClick={onClick}
      action={{ icon: <span />, label: '关闭标签', onClick: onAction }}
      {...overrides}
    />,
  );
  return { onAction, onClick };
}

describe('SidebarItem', () => {
  it('hides only the source list while accepting a compatible drag kind', () => {
    renderItem({ testId: 'source', reorderItemId: 'history', reorderKind: 'loose-tab', reorderListId: 'tabs' });
    act(() => useListReorder.getState().start({ listId: 'commands', id: 'history', kind: 'command-history-group' }, { x: 0, y: 0 }));
    expect(screen.getByTestId('source')).not.toHaveAttribute('data-reorder-dragging');
    act(() => useListReorder.getState().start({ listId: 'tabs', id: 'history', kind: 'page' }, { x: 0, y: 0 }));
    expect(screen.getByTestId('source')).toHaveAttribute('data-reorder-dragging', 'true');
    act(() => useListReorder.getState().end());
  });
  it('keeps shared trailing controls independent from single and double row activation', () => {
    const activate = vi.fn();
    const copy = vi.fn();
    renderItem({ variant: 'command', active: true, onDoubleClick: activate,
      trailingActions: [{ label: 'Copy', control: <button onClick={copy}>Copy</button> }] });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Copy' }));
    expect(copy).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });
  it('renders compact commands without an icon or metadata line and exposes actions on keyboard focus', () => {
    const run = vi.fn();
    const { onClick } = renderItem({ variant: 'command', icon: undefined, title: 'git status --short', testId: 'command-row', tabIndex: 0,
      trailingActions: [{ icon: <span />, label: 'Run command', onClick: run }] });
    const row = screen.getByTestId('command-row');
    expect(row.querySelector('.sidebar-row-icon')).toBeNull();
    expect(row.querySelector('.sidebar-row-subtitle')).toBeNull();
    expect(row.firstElementChild).toHaveStyle({ minHeight: '28px', padding: '2px 10px' });
    expect(screen.getByText('git status --short')).toHaveStyle({ fontFamily: 'var(--font-mono)' });
    expect(row).toHaveAttribute('data-actions-visible', 'false');
    fireEvent.focus(row);
    expect(row).toHaveAttribute('data-actions-visible', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Run command' }));
    expect(run).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps quick actions separate from row activation and honors disabled actions', () => {
    const remove = vi.fn();
    const restore = vi.fn();
    const { onClick } = renderItem({ variant: 'history', compact: true, testId: 'record', leadingActions: [
      { icon: <span />, label: 'Delete record', onClick: remove, disabled: true },
      { icon: <span />, label: 'Restore record', onClick: restore },
    ] });
    const actions = screen.getByRole('button', { name: 'Restore record' }).parentElement!;
    expect(actions).toHaveAttribute('data-visible', 'false');
    fireEvent.mouseOver(screen.getByTestId('record'));
    expect(actions).toHaveAttribute('data-visible', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore record' }));
    expect(restore).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.mouseOut(screen.getByTestId('record'));
    expect(actions).toHaveAttribute('data-visible', 'false');
    fireEvent.focus(screen.getByTestId('record'));
    expect(actions).toHaveAttribute('data-visible', 'true');
  });
  it('keeps compact rows selectable with the same title and action behavior', () => {
    const { onClick, onAction } = renderItem({ compact: true, active: true });
    fireEvent.click(screen.getByText('会话一'));
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭标签' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('keeps the trailing action hidden until hover or selection', () => {
    renderItem();
    const action = screen.getByRole('button', { name: '关闭标签' });
    expect(action).toHaveStyle({ opacity: '0' });

    fireEvent.mouseOver(screen.getByText('会话一'));
    expect(action).toHaveStyle({ opacity: '1' });

    fireEvent.mouseOut(screen.getByText('会话一'));
    expect(action).toHaveStyle({ opacity: '0' });
  });

  it('shows the action on a selected row without hover', () => {
    renderItem({ active: true });
    expect(screen.getByRole('button', { name: '关闭标签' })).toHaveStyle({ opacity: '1' });
  });

  it('preserves page navigation semantics supplied by the owner', () => {
    renderItem({ active: true, testId: 'settings-page', dataAttributes: { 'aria-current': 'page' } });
    expect(screen.getByTestId('settings-page')).toHaveAttribute('aria-current', 'page');
  });

  it('uses theme typography for a selected label without forcing bold text', () => {
    renderItem({ active: true });
    expect(screen.getByText('会话一').style.fontWeight).toBe('var(--fw-semibold)');
  });

  it('allows history rows to use the UI font for subtitles', () => {
    renderItem({ subtitle: '已关闭', subtitleFontFamily: 'var(--font-ui)' });
    expect(screen.getByText('已关闭').style.fontFamily).toBe('var(--font-ui)');
  });

  it('keeps the monospace subtitle default for other sidebar rows', () => {
    renderItem({ subtitle: 'metadata' });
    expect(screen.getByText('metadata').style.fontFamily).toBe('var(--font-mono)');
  });

  it('runs the action without activating the row', () => {
    const { onAction, onClick } = renderItem({ active: true });
    fireEvent.click(screen.getByRole('button', { name: '关闭标签' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the rename input in place of the title', () => {
    renderItem({ renameInput: <input aria-label="重命名" defaultValue="会话一" /> });
    expect(screen.getByLabelText('重命名')).toBeVisible();
    expect(screen.queryByText('会话一')).toBeNull();
  });

  it('renders the row as a reorder item with its kind', () => {
    renderItem({ reorderItemId: 'tab-1', reorderKind: 'tab', testId: 'row-1' });
    const row = screen.getByTestId('row-1');
    expect(row).toHaveAttribute('data-reorder-item', 'tab-1');
    expect(row).toHaveAttribute('data-reorder-kind', 'tab');
    expect(row).toHaveAttribute('data-tip', '会话提示');
  });

  it.each(['default', 'history'] as const)('preserves the standard row height and text sizing for %s two-line records', variant => {
    renderItem({ variant, subtitle: 'Closed', testId: 'standard-row' });
    const row = screen.getByTestId('standard-row');
    expect(row).toHaveStyle({ padding: '2px 6px' });
    expect(row.firstElementChild).toHaveStyle({ minHeight: '40px', padding: '8px 10px' });
    expect(screen.getByText('会话一')).toHaveStyle({ lineHeight: '18px' });
    expect(screen.getByText('Closed')).toHaveStyle({ fontSize: 'calc(11px * var(--ui-font-scale))', lineHeight: '14px' });
  });

  it('reveals history actions during keyboard focus and hides them when focus leaves', () => {
    renderItem({ variant: 'history', compact: true, active: true, tabIndex: 0, subtitle: 'Closed', testId: 'history-row' });
    const row = screen.getByTestId('history-row');
    const action = screen.getByRole('button', { name: '关闭标签' });
    expect(action).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
    fireEvent.focus(row);
    expect(action).toHaveStyle({ opacity: '1' });
    fireEvent.blur(row, { relatedTarget: action });
    fireEvent.focus(action);
    expect(action).toHaveStyle({ opacity: '1' });
    fireEvent.blur(action, { relatedTarget: document.body });
    expect(action).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
    expect(screen.getByText('会话一')).toHaveAttribute('data-tip', '会话一');
    expect(screen.getByText('Closed')).toHaveAttribute('data-tip', 'Closed');
  });

  it('shows basic history metadata without hover and retains the complete accessible description', () => {
    renderItem({ variant: 'history', compact: true, title: 'Project review', subtitle: 'Closed · /home/project', testId: 'compact-history-row' });
    const row = screen.getByTestId('compact-history-row');
    expect(screen.getByText('Closed · /home/project')).toBeVisible();
    expect(row).toHaveAccessibleDescription('Closed · /home/project');
    expect(row).toHaveAttribute('data-tip', 'Project review');
    expect(row).toHaveAttribute('data-tip-description', 'Closed · /home/project');
    expect(screen.getByText('Project review')).toHaveAttribute('data-tip-description', 'Closed · /home/project');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SidebarItem from '../sidebarItem';

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

  it('uses theme typography for a selected label without forcing bold text', () => {
    renderItem({ active: true });
    expect(screen.getByText('会话一').style.fontWeight).toBe('var(--fw-semibold)');
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
});

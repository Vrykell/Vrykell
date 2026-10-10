import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CheckboxMenu from '@ui/CheckboxMenu';

const options = [
  { id: 'a', label: '命令历史', checked: true, count: 3 },
  { id: 'b', label: '文件', checked: false },
];

describe('CheckboxMenu', () => {
  it('supports compact labels, footer actions and keyboard navigation without propagating Escape', () => {
    const onClose = vi.fn();
    const parentKey = vi.fn();
    render(<div onKeyDown={parentKey}><CheckboxMenu compact title="Shortcuts" options={options.map(option => ({ ...option, displayLabel: <kbd>{option.id}</kbd> }))}
      onToggle={vi.fn()} onClose={onClose} footer={<button>Custom</button>} /></div>);
    expect(screen.queryByText('Shortcuts')).toBeNull();
    const first = screen.getByRole('menuitemcheckbox', { name: '命令历史' });
    first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemcheckbox', { name: '文件' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(parentKey).not.toHaveBeenCalled();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('toggles an item and stays open', () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    render(<CheckboxMenu title="搜索范围" options={options} onToggle={onToggle} onClose={onClose} />);

    fireEvent.click(screen.getByText('文件'));

    expect(onToggle).toHaveBeenCalledWith('b');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitemcheckbox', { name: /命令历史/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('closes when it loses focus or on Escape', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<CheckboxMenu title="搜索范围" options={options} onToggle={vi.fn()} onClose={onClose} />);
    act(() => { vi.advanceTimersByTime(1); });

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('leaves trigger presses to the trigger toggle instead of closing and reopening', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button'); document.body.append(trigger);
    const onClose = vi.fn();
    render(<CheckboxMenu title="Shortcuts" options={options} onToggle={vi.fn()} onClose={onClose} triggerRef={{ current: trigger }} />);
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.pointerDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    trigger.remove();
  });
});

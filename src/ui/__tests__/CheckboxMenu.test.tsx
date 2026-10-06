import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CheckboxMenu from '@ui/CheckboxMenu';

const options = [
  { id: 'a', label: '命令历史', checked: true, count: 3 },
  { id: 'b', label: '文件', checked: false },
];

describe('CheckboxMenu', () => {
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
});

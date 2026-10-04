import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../ConfirmDialog';

describe('confirmation dialog', () => {
  it('keeps inner clicks separate from backdrop cancellation and confirmation', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(<ConfirmDialog open title="删除会话" message="确认删除？" danger onConfirm={confirm} onCancel={cancel} />);
    fireEvent.click(screen.getByText('确认删除？'));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByTestId('confirm-dialog'));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeVisible();
  });

  it('does not mount a closed dialog', () => {
    render(<ConfirmDialog open={false} title="删除会话" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PermissionModeButton from '../components/PermissionModeButton';

describe('shared permission control', () => {
  it('cycles the same three modes with concise descriptions and accessible names', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PermissionModeButton mode="standard" onChange={onChange} />);
    const standard = screen.getByRole('button', { name: '标准权限' });
    expect(standard).toHaveClass('icon-button');
    expect(standard).toHaveAttribute('data-tip-description', '按工具设置判定。');
    fireEvent.click(standard);
    expect(onChange).toHaveBeenLastCalledWith('strict');
    rerender(<PermissionModeButton mode="strict" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '严格权限' }));
    expect(onChange).toHaveBeenLastCalledWith('relaxed');
    rerender(<PermissionModeButton mode="relaxed" onChange={onChange} />);
    const relaxed = screen.getByRole('button', { name: '放行模式' });
    expect(relaxed).toHaveAttribute('data-tip-description', '工具直接放行，危险命令仍需确认。');
    fireEvent.click(relaxed);
    expect(onChange).toHaveBeenLastCalledWith('standard');
  });
});

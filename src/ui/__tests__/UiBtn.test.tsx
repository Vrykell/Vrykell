import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconBtn, ToolbarBtn } from '../UiBtn';
import { Plus } from '../icons';

describe('icon control targets', () => {
  it('provides a named 32px target and respects disabled state', () => {
    const click = vi.fn();
    const { rerender } = render(<IconBtn title="新建终端" onClick={click}><Plus size={18} /></IconBtn>);
    const button = screen.getByRole('button', { name: '新建终端' });
    expect(button).toHaveStyle({ width: '32px', height: '32px' });
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    rerender(<IconBtn title="新建终端" disabled onClick={click}><Plus size={18} /></IconBtn>);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });

  it('keeps toolbar controls equally easy to click', () => {
    render(<ToolbarBtn title="资源"><Plus size={24} /></ToolbarBtn>);
    expect(screen.getByRole('button', { name: '资源' })).toHaveStyle({ width: '32px', height: '32px' });
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HBtn, InputBtn, IconBtn, ToolbarBtn } from '@ui/actions/UiBtn';
import { IconButton } from '@ui/actions/IconButton';
import { Plus } from '@ui/icons';

describe('icon control targets', () => {
  it('provides a named 32px target and respects disabled state', () => {
    const click = vi.fn();
    const { rerender } = render(<IconBtn title="新建终端" onClick={click}><Plus size={18} /></IconBtn>);
    const button = screen.getByRole('button', { name: '新建终端' });
    expect(button).toHaveClass('icon-button');
    expect(button).toHaveAttribute('data-compact', 'false');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    rerender(<IconBtn title="新建终端" disabled onClick={click}><Plus size={18} /></IconBtn>);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });

  it('keeps toolbar controls equally easy to click', () => {
    render(<ToolbarBtn title="资源"><Plus size={24} /></ToolbarBtn>);
    expect(screen.getByRole('button', { name: '资源' })).toHaveClass('icon-button');
  });
  it('shares text controls and prevents disabled icon actions', () => {
    const click = vi.fn();
    render(<><HBtn title="History" onClick={click}>History</HBtn><InputBtn title="Mode" onClick={click}>Mode</InputBtn><IconButton tone="danger" disabled aria-label="Remove" onClick={click}><Plus /></IconButton></>);
    expect(screen.getByRole('button', { name: 'History' })).toHaveClass('text-control');
    expect(screen.getByRole('button', { name: 'Mode' })).toHaveClass('text-control');
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove).toHaveAttribute('data-tone', 'danger');
    fireEvent.click(remove);
    expect(click).not.toHaveBeenCalled();
  });
});

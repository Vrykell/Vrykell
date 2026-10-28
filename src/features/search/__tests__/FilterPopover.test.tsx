import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Terminal, FileText } from '@ui/icons';
import FilterPopover from '@features/search/components/FilterPopover';
import { registerSource } from '@features/search/services/registry';

// Register two fake sources (avoids importing search/init, which pulls in the backend invoke)
registerSource({ id: 'history', label: '命令历史', icon: Terminal, search: async () => [] });
registerSource({ id: 'file', label: '文件', icon: FileText, search: async () => [] });

describe('FilterPopover', () => {
  it('switching open from false to true does not crash (stable hook order, regression for a conditional hook crash)', () => {
    const { rerender } = render(<FilterPopover open={false} onClose={() => {}} counts={{}} />);
    expect(() =>
      rerender(<FilterPopover open={true} onClose={() => {}} counts={{}} />),
    ).not.toThrow();

    expect(screen.getByText('搜索范围')).toBeInTheDocument();
    expect(screen.getByText('命令历史')).toBeInTheDocument();
    expect(screen.getByText('文件')).toBeInTheDocument();
  });

  it('stays expanded after toggling a source instead of closing itself', () => {
    const onClose = vi.fn();
    render(<FilterPopover open={true} onClose={onClose} counts={{}} />);
    fireEvent.click(screen.getByText('命令历史'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('搜索范围')).toBeInTheDocument();
  });
});

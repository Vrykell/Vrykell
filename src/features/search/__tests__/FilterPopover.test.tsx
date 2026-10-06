import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Terminal, FileText } from '@ui/icons';
import FilterPopover from '@features/search/components/FilterPopover';
import { registerSource } from '@features/search/services/registry';

// 注册两个假源（避免 import search/init 拉入后端 invoke）
registerSource({ id: 'history', label: '命令历史', icon: Terminal, search: async () => [] });
registerSource({ id: 'file', label: '文件', icon: FileText, search: async () => [] });

describe('FilterPopover', () => {
  it('open 从 false 切到 true 不崩溃（hook 顺序稳定，回归条件 hook 崩溃）', () => {
    const { rerender } = render(<FilterPopover open={false} onClose={() => {}} counts={{}} />);
    expect(() =>
      rerender(<FilterPopover open={true} onClose={() => {}} counts={{}} />),
    ).not.toThrow();

    expect(screen.getByText('搜索范围')).toBeInTheDocument();
    expect(screen.getByText('命令历史')).toBeInTheDocument();
    expect(screen.getByText('文件')).toBeInTheDocument();
  });

  it('切换某个源后保持展开，不自动关闭', () => {
    const onClose = vi.fn();
    render(<FilterPopover open={true} onClose={onClose} counts={{}} />);
    fireEvent.click(screen.getByText('命令历史'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('搜索范围')).toBeInTheDocument();
  });
});

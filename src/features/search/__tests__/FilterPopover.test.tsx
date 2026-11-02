import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Terminal, FileText } from '@ui/icons';
import FilterPopover from '@features/search/components/FilterPopover';
import { registerSource, useEnabledSourcesStore } from '@features/search/services/registry';

// Register two fake sources (avoids importing search/init, which pulls in the backend invoke)
registerSource({ id: 'history', label: '命令历史', icon: Terminal, search: async () => [] });
registerSource({ id: 'file', label: '文件', icon: FileText, search: async () => [] });

describe('FilterPopover', () => {
  beforeEach(() => {
    useEnabledSourcesStore.setState({ enabledIds: new Set(['history', 'file']) });
  });

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

  it('marks enabled sources with a trailing check instead of a leading checkbox', () => {
    useEnabledSourcesStore.setState({ enabledIds: new Set(['history']) });
    render(<FilterPopover open={true} onClose={() => {}} counts={{ history: 4 }} />);
    const history = screen.getByRole('menuitemcheckbox', { name: /命令历史/ });
    const file = screen.getByRole('menuitemcheckbox', { name: '文件' });

    expect(history.querySelector('input.themed-checkbox')).toBeNull();
    expect(history.querySelectorAll('svg').length).toBe(2);
    expect(file.querySelector('input.themed-checkbox')).toBeNull();
    expect(file.querySelectorAll('svg').length).toBe(1);
  });
});

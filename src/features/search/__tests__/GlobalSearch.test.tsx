import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileText, History } from '@ui/icons';
import { registerSource, useEnabledSourcesStore } from '../services/registry';
import { useSearchHistoryStore } from '../stores/searchHistory';
import { useTerminalStore } from '@features/terminal';
import type { SearchResult } from '../types';
import GlobalSearch from '../components/GlobalSearch';

const historySearch = vi.fn<(query: string) => Promise<SearchResult[]>>();
const fileSearch = vi.fn<(query: string) => Promise<SearchResult[]>>();
registerSource({ id: 'history', label: '命令历史', icon: History, search: historySearch });
registerSource({ id: 'file', label: '文件', icon: FileText, search: fileSearch });

function result(command: string): SearchResult {
  return { id: command, type: 'history', title: command,
    data: { command, cwd: '/workspace', exitCode: 0, timestamp: 1, runCount: 1 } };
}

beforeEach(() => {
  useSearchHistoryStore.setState({ items: [] });
  useEnabledSourcesStore.getState().setAll(new Set(['history', 'file']));
  historySearch.mockReset().mockResolvedValue([result('npm run dev'), result('npm test')]);
  fileSearch.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe('workspace search palette', () => {
  it('shows source guidance and focuses the input on opening', async () => {
    render(<GlobalSearch open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeVisible();
    expect(screen.getByText('查找工作区中的内容')).toBeVisible();
    expect(screen.getByText('2 个搜索来源')).toBeVisible();
    expect(screen.getByText('命令历史')).toBeVisible();
    expect(screen.getByText('文件')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  });

  it('toggles one source independently and Escape closes the scope menu first', () => {
    const close = vi.fn();
    render(<GlobalSearch open onClose={close} />);
    fireEvent.click(screen.getByTestId('search-filter-button'));
    const history = screen.getByRole('menuitemcheckbox', { name: /命令历史/ });
    fireEvent.click(history);
    expect(history).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemcheckbox', { name: /文件/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('1 个搜索来源')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps arrow and Enter navigation working with grouped results', async () => {
    const close = vi.fn();
    const { container } = render(<GlobalSearch open onClose={close} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'npm' } });
    await screen.findByText('2 个结果');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(container.querySelector('[data-search-result][data-selected="true"]')).toHaveTextContent('npm test');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useTerminalStore.getState().pendingInput).toBe('npm test');
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps successful results and offers retry when a source fails', async () => {
    fileSearch.mockRejectedValue(new Error('Unavailable'));
    render(<GlobalSearch open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'npm' } });
    expect(await screen.findByText('部分搜索源失败：文件')).toBeVisible();
    expect(screen.getByText('2 个结果')).toBeVisible();
    fileSearch.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('leaves Enter on palette buttons to their own action instead of executing a result', async () => {
    const close = vi.fn();
    render(<GlobalSearch open onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'npm' } });
    await screen.findByText('2 个结果');
    fireEvent.keyDown(screen.getByTestId('search-filter-button'), { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
  });
});

it('turns prefixes into removable scope cards and retains the scope in recent searches', async () => {
  useSearchHistoryStore.setState({ items: ['! npm'] });
  render(<GlobalSearch open onClose={vi.fn()} />);
  expect(screen.getByTestId('history-scope-chip')).toHaveTextContent('命令历史');
  fireEvent.click(screen.getByText('npm'));
  expect(screen.getByTestId('search-scope-chip')).toHaveTextContent('命令历史');
  expect(screen.queryByTestId('search-filter-button')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('npm');
  fireEvent.click(screen.getByRole('button', { name: '清除搜索范围' }));
  expect(screen.getByRole('textbox')).toHaveValue('npm');
  expect(screen.getByTestId('search-filter-button')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '!' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Backspace' });
  expect(screen.queryByTestId('search-scope-chip')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
});

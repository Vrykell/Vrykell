import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SearchResultCard from '../components/SearchResultCard';
import type { SearchResult, BlockResultData } from '../types';

function blockResult(overrides: Partial<BlockResultData> = {}): SearchResult {
  return {
    id: 'result', type: 'block', title: 'git --help', subtitle: 'Git command help',
    data: { blockId: 'b', tabId: 't', command: 'git --help', exitCode: 0,
      status: 'completed', startLine: 0, startedAt: 1, ...overrides },
  };
}

describe('search result actions', () => {
  it('keeps query highlighting and executes on click', () => {
    const result = blockResult();
    const execute = vi.fn();
    const { container } = render(<SearchResultCard result={result} selected query="Git" onSelect={vi.fn()} onExecute={execute} />);

    expect(screen.getAllByText(/git/i).some(el => el.tagName === 'MARK')).toBe(true);
    fireEvent.click(container.querySelector('[data-search-result]')!);
    expect(execute).toHaveBeenCalledWith(result);
  });

  it('renders one secondary line and no leading icon', () => {
    const result = { ...blockResult(), detail: 'Terminal · 1 min ago' };
    const { container } = render(
      <SearchResultCard result={result} selected={false} query="" onSelect={vi.fn()} onExecute={vi.fn()} />,
    );

    expect(screen.getByText('Git command help')).toBeVisible();
    expect(screen.queryByText('Terminal · 1 min ago')).not.toBeInTheDocument();
    expect(container.querySelector('[data-search-result] svg')).toBeNull();
  });

  it('restores historical results through the normal click path without restore controls', () => {
    const result = blockResult({ sessionStatus: 'historical', tabTitle: '远程' });
    const execute = vi.fn();
    render(<SearchResultCard result={result} selected={false} query="" onSelect={vi.fn()} onExecute={execute} />);

    fireEvent.click(screen.getByText('git --help'));
    expect(execute).toHaveBeenCalledWith(result);
    expect(screen.queryByText('历史会话')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('恢复此会话')).not.toBeInTheDocument();
  });

  it('selects on pointer movement but not on passive mouse entry', () => {
    const select = vi.fn();
    render(<SearchResultCard result={blockResult()} selected={false} query="" onSelect={select} onExecute={vi.fn()} />);
    const row = screen.getByText('git --help').closest('[data-search-result]')!;

    fireEvent.mouseEnter(row);
    expect(select).not.toHaveBeenCalled();
    fireEvent.pointerMove(row);
    expect(select).toHaveBeenCalledOnce();
  });
});

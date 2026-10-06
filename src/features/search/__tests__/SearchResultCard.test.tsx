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
  it('keeps query highlighting and opens the selected command result', () => {
    const result = blockResult();
    const execute = vi.fn();
    render(<SearchResultCard result={result} selected query="Git" onSelect={vi.fn()} onExecute={execute} />);
    expect(screen.getByText('完成')).toBeVisible();
    expect(screen.getAllByText(/git/i).some(el => el.tagName === 'MARK')).toBe(true);
    fireEvent.click(screen.getByText('完成'));
    expect(execute).toHaveBeenCalledWith(result);
  });

  it('restores historical sessions from both the row and the restore action', () => {
    const restore = vi.fn();
    const execute = vi.fn();
    render(<SearchResultCard result={blockResult({ sessionStatus: 'historical', tabTitle: '远程' })}
      selected={false} query="" onSelect={vi.fn()} onExecute={execute} onRestore={restore} />);
    fireEvent.click(screen.getByText('历史会话'));
    fireEvent.click(screen.getByLabelText('恢复此会话'));
    expect(restore.mock.calls).toEqual([['t', '远程'], ['t', '远程']]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('retains failure status and hover selection', () => {
    const select = vi.fn();
    render(<SearchResultCard result={blockResult({ exitCode: 1, status: 'failed' })}
      selected={false} query="" onSelect={select} onExecute={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByText('失败').closest('[data-search-result]')!);
    expect(select).toHaveBeenCalledOnce();
    expect(screen.getByText('失败')).toBeVisible();
  });
});

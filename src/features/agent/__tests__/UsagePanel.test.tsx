import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@ui/Toast';
import UsagePanel from '../components/UsagePanel';
import { useUsageStore } from '../stores/usage';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  useUsageStore.setState({ records: [] });
  useToastStore.setState({ toasts: [], timers: {} });
});

afterEach(() => cleanup());

describe('UsagePanel', () => {
  it('explains the empty state and refuses to clear nothing', () => {
    render(<UsagePanel />);
    expect(screen.getByTestId('usage-empty')).toHaveTextContent('暂无用量');
    expect(screen.getByTestId('usage-clear')).toBeDisabled();
    expect(screen.queryByTestId('usage-model-row')).toBeNull();
  });

  it('leads with the estimated cost and breaks it down per model', () => {
    useUsageStore.getState().recordTurn({
      provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 1200, outputTokens: 300,
      cachedInputTokens: 800, steps: 2, toolCalls: 3, at: Date.now(),
    });
    render(<UsagePanel />);

    // (400 fresh × $3 + 800 cached × $0.3 + 300 out × $15) / 1M = $0.00594
    expect(screen.getByTestId('usage-total-cost')).toHaveTextContent('$0.0059');
    expect(screen.getByTestId('usage-cost-caption')).toHaveTextContent('1 次请求');
    expect(screen.getByTestId('usage-cost-caption')).toHaveTextContent('1.5k tokens');
    expect(screen.getByTestId('usage-cost-chart')).toBeInTheDocument();

    const row = screen.getByTestId('usage-model-row');
    expect(row).toHaveAttribute('data-model', 'claude-sonnet-4');
    expect(screen.getByTestId('usage-model-requests')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-model-input')).toHaveTextContent('1.2k');
    expect(screen.getByTestId('usage-model-output')).toHaveTextContent('300');
    expect(screen.getByTestId('usage-model-cost')).toHaveTextContent('$0.0059');
    expect(screen.getByTestId('usage-model-secondary')).toHaveTextContent('anthropic');
    expect(screen.getByTestId('usage-model-secondary')).toHaveTextContent('缓存命中 800');
    expect(screen.getByTestId('usage-recent-row')).toHaveTextContent('claude-sonnet-4');
  });

  it('marks a model without a known price instead of guessing', () => {
    useUsageStore.getState().recordTurn({
      provider: 'openai-compatible', model: 'internal-preview-model', inputTokens: 500, at: Date.now(),
    });
    render(<UsagePanel />);
    expect(screen.getByTestId('usage-total-cost')).toHaveTextContent('$0');
    expect(screen.getByTestId('usage-model-cost')).toHaveTextContent('—');
    expect(screen.getByTestId('usage-cost-caption')).toHaveTextContent('1 次请求未收录价格');
  });

  it('filters by range and keeps the older turn under "all"', () => {
    const now = Date.now();
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, at: now });
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, at: now - 10 * DAY });
    render(<UsagePanel />);
    expect(screen.getByTestId('usage-cost-caption')).toHaveTextContent('1 次请求');

    fireEvent.click(screen.getByRole('combobox', { name: '统计范围' }));
    fireEvent.click(screen.getByRole('option', { name: '全部' }));
    expect(screen.getByTestId('usage-cost-caption')).toHaveTextContent('2 次请求');
    expect(screen.getAllByTestId('usage-recent-row')).toHaveLength(2);
    expect(screen.getByTestId('usage-model-requests')).toHaveTextContent('2');
  });

  it('clears the records and confirms it', () => {
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100 });
    render(<UsagePanel />);
    fireEvent.click(screen.getByTestId('usage-clear'));
    expect(useUsageStore.getState().records).toEqual([]);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['已清空用量数据']);
    expect(screen.getByTestId('usage-empty')).toBeInTheDocument();
  });
});

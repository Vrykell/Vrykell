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

  it('shows provider counts, the per-model split and the recent turn', () => {
    useUsageStore.getState().recordTurn({
      provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 1200, outputTokens: 300,
      cachedInputTokens: 800, steps: 2, toolCalls: 3, at: Date.now(),
    });
    render(<UsagePanel />);
    expect(screen.getByTestId('usage-turns')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('1,500');
    expect(screen.getByTestId('usage-input-tokens')).toHaveTextContent('1,200');
    expect(screen.getByTestId('usage-output-tokens')).toHaveTextContent('300');
    expect(screen.getByTestId('usage-cached-tokens')).toHaveTextContent('800');
    expect(screen.getByTestId('usage-tool-calls')).toHaveTextContent('3');
    expect(screen.getByTestId('usage-steps')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-model-row')).toHaveAttribute('data-model', 'claude-sonnet-4');
    expect(screen.getByTestId('usage-model-row')).toHaveTextContent('1 次请求');
    expect(screen.getByTestId('usage-recent-row')).toHaveTextContent('claude-sonnet-4');
    // Reasoning tokens stay hidden until a model reports them.
    expect(screen.queryByTestId('usage-reasoning-tokens')).toBeNull();
  });

  it('filters by range and keeps the older turn under "all"', () => {
    const now = Date.now();
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, at: now });
    useUsageStore.getState().recordTurn({ provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, at: now - 10 * DAY });
    render(<UsagePanel />);
    expect(screen.getByTestId('usage-turns')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('combobox', { name: '统计范围' }));
    fireEvent.click(screen.getByRole('option', { name: '全部' }));
    expect(screen.getByTestId('usage-turns')).toHaveTextContent('2');
    expect(screen.getAllByTestId('usage-recent-row')).toHaveLength(2);
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

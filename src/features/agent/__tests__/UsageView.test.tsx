import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@ui/Toast';
import UsageView from '../components/UsageView';
import { useUsageStore } from '../stores/usage';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  useUsageStore.setState({ records: [] });
  useToastStore.setState({ toasts: [], timers: {} });
});

afterEach(() => cleanup());

function seedSonnetTurn(at = Date.now()) {
  useUsageStore.getState().recordTurn({
    provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 1200, outputTokens: 300,
    cachedInputTokens: 800, steps: 2, toolCalls: 3, at,
  });
}

describe('UsageView', () => {
  it('shows zeroed metrics and an empty log before the first turn', () => {
    render(<UsageView />);
    expect(screen.getByTestId('usage-page')).toBeInTheDocument();
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('0');
    // 没有输入时命中率没有意义，显示占位符
    expect(screen.getByTestId('usage-cache-hit')).toHaveTextContent('—');
    expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();
    expect(screen.getByText('这段时间没有记录到用量。')).toBeInTheDocument();
    expect(screen.getByTestId('usage-clear')).toBeDisabled();
  });

  it('shows every metric card at once, with the counting rule on the label hover', () => {
    seedSonnetTurn();
    render(<UsageView />);

    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('1500');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-fresh-input')).toHaveTextContent('400');
    expect(screen.getByTestId('usage-cache-hit')).toHaveTextContent('66.7%');
    // 其余指标一次性展示，不再折叠
    expect(screen.getByTestId('usage-output')).toHaveTextContent('300');
    expect(screen.getByTestId('usage-cache-read')).toHaveTextContent('800');
    expect(screen.getByTestId('usage-steps')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-tool-calls')).toHaveTextContent('3');
    expect(screen.queryByTestId('usage-more-metrics')).toBeNull();

    // 口径提示挂在文字上（没有额外的 ⓘ 图标）
    const card = screen.getByTestId('usage-fresh-input').parentElement!;
    const tip = card.querySelector('[data-tip-description]');
    expect(tip).not.toBeNull();
    expect(card.querySelector('svg')).toBeNull();
  });

  it('keeps four metric cards per row regardless of the page width', () => {
    seedSonnetTurn();
    render(<UsageView />);
    // 固定四列：窗口变窄也不会挤成三列（卡片位置不跳动）
    expect(screen.getByTestId('usage-metrics').getAttribute('style')).toContain('repeat(4, minmax(0, 1fr))');
  });

  it('summarises the turn and lists it in the log', () => {
    seedSonnetTurn();
    render(<UsageView />);

    const row = screen.getByTestId('usage-log-row');
    expect(row).toHaveAttribute('data-model', 'claude-sonnet-4');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent(/^\d{2}:\d{2}:\d{2}$/);
    expect(cells[1]).toHaveTextContent('anthropic');
    expect(cells[2]).toHaveTextContent('claude-sonnet-4');
    expect(cells[3]).toHaveTextContent('400');
    expect(cells[4]).toHaveTextContent('300');
    expect(cells[5]).toHaveTextContent('800');
    expect(cells[6]).toHaveTextContent('2');
    expect(cells[7]).toHaveTextContent('3');
  });

  it('switches the trend metric and the detail tables', () => {
    seedSonnetTurn();
    render(<UsageView />);

    // 行首的品牌色标记：按模型家族取色（Claude → Anthropic 品牌色）
    const dot = within(screen.getByTestId('usage-log-row')).getByTestId('usage-vendor-dot');
    expect(dot).toHaveAttribute('data-vendor', 'Anthropic');
    expect(dot).toHaveStyle({ background: 'var(--brand-anthropic)' });

    fireEvent.click(screen.getByTestId('usage-metric-requests'));
    expect(screen.getByTestId('usage-metric-requests')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('usage-tab-providers'));
    const providerRow = screen.getByTestId('usage-provider-row');
    expect(providerRow).toHaveAttribute('data-provider', 'anthropic');
    expect(within(providerRow).getAllByRole('cell')[1]).toHaveTextContent('1');
    expect(within(providerRow).getByTestId('usage-vendor-dot')).toHaveAttribute('data-vendor', 'anthropic');

    fireEvent.click(screen.getByTestId('usage-tab-models'));
    expect(screen.getByTestId('usage-model-row')).toHaveAttribute('data-model', 'claude-sonnet-4');
    expect(screen.queryByTestId('usage-log-row')).toBeNull();
  });

  it('marks a gateway row with the vendor of the model it serves', () => {
    useUsageStore.getState().recordTurn({
      provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 10, at: Date.now(),
    });
    render(<UsageView />);
    const dot = within(screen.getByTestId('usage-log-row')).getByTestId('usage-vendor-dot');
    expect(dot).toHaveAttribute('data-vendor', 'OpenAI');
    expect(dot).toHaveStyle({ background: 'var(--brand-openai)' });
  });

  it('filters by provider and model, and by range', () => {
    seedSonnetTurn();
    useUsageStore.getState().recordTurn({
      provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 100,
      cachedInputTokens: 100, at: Date.now() - 10 * DAY,
    });
    render(<UsageView />);
    // 默认「当天」：只有今天那条
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('usage-range'));
    fireEvent.click(screen.getByRole('option', { name: '全部' }));
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('usage-filter-provider'));
    fireEvent.click(screen.getByRole('option', { name: 'openai-compatible' }));
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('600');
    expect(screen.getAllByTestId('usage-log-row')).toHaveLength(1);
  });

  it('paginates the request log past one page', () => {
    for (let index = 0; index < 25; index += 1) {
      useUsageStore.getState().recordTurn({
        provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 10, at: Date.now() - index * 1000,
      });
    }
    render(<UsageView />);
    expect(screen.getAllByTestId('usage-log-row')).toHaveLength(20);
    expect(screen.getByTestId('usage-page-label')).toHaveTextContent('第 1 / 2 页');
    expect(screen.getByTestId('usage-page-prev')).toBeDisabled();

    fireEvent.click(screen.getByTestId('usage-page-next'));
    expect(screen.getAllByTestId('usage-log-row')).toHaveLength(5);
    expect(screen.getByTestId('usage-page-label')).toHaveTextContent('第 2 / 2 页');
    expect(screen.getByTestId('usage-page-next')).toBeDisabled();
  });

  it('clears the records and confirms it', () => {
    seedSonnetTurn();
    render(<UsageView />);
    fireEvent.click(screen.getByTestId('usage-clear'));
    expect(useUsageStore.getState().records).toEqual([]);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['已清空用量数据']);
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('0');
  });
});

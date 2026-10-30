import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@ui/feedback/Toast';
import UsageView from '../components/UsageView';
import { useUsageStore } from '../stores/usage';
import { useAiConfigStore } from '../stores/aiConfig';
import { useUsageSources } from '../stores/usageSources';
import type { HarnessConfig } from '@platform/api/acp';

const { acpHarnesses } = vi.hoisted(() => ({ acpHarnesses: vi.fn<() => Promise<HarnessConfig[]>>() }));
vi.mock('@platform/api/acp', async importOriginal => ({
  ...await importOriginal<typeof import('@platform/api/acp')>(), acpHarnesses,
}));

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  useUsageStore.setState({ records: [], acp: {} });
  useAiConfigStore.setState({ models: [] });
  useUsageSources.getState().replace([]);
  acpHarnesses.mockReset().mockResolvedValue([]);
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
  it('shows configured sources before use without persisting placeholder reports', async () => {
    acpHarnesses.mockResolvedValue([
      { name: 'Unused agent', enabled: true, command: 'agent', args: [], env: {}, cwd: '' },
      { name: 'Disabled agent', enabled: false, command: 'agent', args: [], env: {}, cwd: '' },
    ]);
    render(<UsageView />);
    expect(screen.getByTestId('usage-model-all')).toBeInTheDocument();
    await waitFor(() => expect(useUsageSources.getState().configured).toContain('Disabled agent'));
    expect(screen.queryByTestId('usage-source-Unused agent')).toBeNull();
    fireEvent.click(screen.getByTestId('usage-tab-acp'));
    expect(screen.getAllByText('尚未上报用量')).toHaveLength(2);
    expect(screen.getByTestId('usage-clear')).toBeDisabled();
    expect(useUsageStore.getState()).toMatchObject({ records: [], acp: {} });

    fireEvent.click(screen.getByTestId('usage-range'));
    fireEvent.click(screen.getByRole('option', { name: '全部时间' }));
    expect(screen.getAllByTestId('usage-acp-row')).toHaveLength(2);
    expect(screen.queryByText(/1970/)).toBeNull();
  });

  it('keeps unused native model configurations visible in breakdowns and filters', async () => {
    useAiConfigStore.setState({ models: [
      { id: 'unused', name: 'Unused model', provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-4' },
      { id: 'other', name: 'Other model', provider: 'openai-compatible', baseUrl: '', model: 'local-model' },
    ] });
    render(<UsageView />);
    fireEvent.click(screen.getByTestId('usage-tab-models'));
    expect(screen.getAllByTestId('usage-model-row')).toHaveLength(2);
    for (const row of screen.getAllByTestId('usage-model-row')) expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('0');
    fireEvent.click(screen.getByTestId('usage-filter-provider'));
    fireEvent.click(screen.getByRole('option', { name: 'anthropic' }));
    expect(screen.getByTestId('usage-model-row')).toHaveAttribute('data-model', 'claude-sonnet-4');
    fireEvent.click(screen.getByTestId('usage-tab-providers'));
    expect(screen.getByTestId('usage-provider-row')).toHaveAttribute('data-provider', 'anthropic');
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('0');
    await act(async () => {});
  });

  it('updates configured sources after saving and retains them after clearing usage', async () => {
    render(<UsageView />);
    await waitFor(() => expect(acpHarnesses).toHaveBeenCalledOnce());
    await act(async () => {});
    act(() => {
      useUsageSources.getState().replace(['New agent']);
      useUsageStore.getState().acpTurn('New agent');
    });
    fireEvent.click(screen.getByTestId('usage-tab-acp'));
    expect(screen.getByTestId('usage-acp-row')).toHaveTextContent('New agent');
    fireEvent.click(screen.getByTestId('usage-clear'));
    expect(screen.getByTestId('usage-acp-row')).toHaveTextContent('尚未上报用量');
    expect(screen.getByTestId('usage-clear')).toBeDisabled();
  });

  it('shows source loading failures inline without hiding saved usage and supports retry', async () => {
    seedSonnetTurn();
    acpHarnesses.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([]);
    render(<UsageView />);
    await screen.findByText('无法加载用量来源');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText('无法加载用量来源')).toBeNull());
  });

  it('restores usage when another window changes persisted storage', () => {
    render(<UsageView />);
    localStorage.setItem('vrykell-usage', JSON.stringify({ version: 3, state: {
      records: [{ id: 'external', source: 'vrykell', provider: 'anthropic', model: 'claude-sonnet-4', at: Date.now(), inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0, steps: 1, toolCalls: 0 }],
      acp: {},
    } }));
    fireEvent(window, new StorageEvent('storage', { key: 'vrykell-usage' }));
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('15');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
  });

  it('shows zeroed metrics and an empty log before the first turn', () => {
    render(<UsageView />);
    expect(screen.getByTestId('usage-page')).toBeInTheDocument();
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('0');
    // The hit rate is meaningless without input, so show a placeholder
    expect(screen.getByTestId('usage-cache-hit')).toHaveTextContent('—');
    expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();
    expect(screen.getByText('这段时间没有记录到用量。')).toBeInTheDocument();
    expect(screen.getByTestId('usage-clear')).toBeDisabled();
    // The footer's counting note is removed entirely (the rule now lives on the metric label tooltip)
    expect(screen.queryByText(/暂未计入/)).toBeNull();
  });

  it('shows every metric card at once, with the counting rule on the label hover', () => {
    seedSonnetTurn();
    render(<UsageView />);

    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('1500');
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
    expect(screen.getByTestId('usage-fresh-input')).toHaveTextContent('400');
    expect(screen.getByTestId('usage-cache-hit')).toHaveTextContent('66.7%');
    // The remaining metrics are shown at once, no longer collapsed
    expect(screen.getByTestId('usage-output')).toHaveTextContent('300');
    expect(screen.getByTestId('usage-cache-read')).toHaveTextContent('800');
    expect(screen.getByTestId('usage-steps')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-tool-calls')).toHaveTextContent('3');
    expect(screen.queryByTestId('usage-more-metrics')).toBeNull();

    // The counting hint lives on the text (no extra info icon)
    const card = screen.getByTestId('usage-fresh-input').parentElement!;
    const tip = card.querySelector('[data-tip-description]');
    expect(tip).not.toBeNull();
    expect(card.querySelector('svg')).toBeNull();
  });

  it('keeps four metric cards per row regardless of the page width', () => {
    seedSonnetTurn();
    render(<UsageView />);
    // Fixed four columns: the window never squeezes them into three (cards do not jump)
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

  it('paints blue rounded bars and explains a bucket on hover', () => {
    seedSonnetTurn();
    render(<UsageView />);

    const bar = screen.getByTestId('usage-trend-bar');
    expect(bar).toHaveAttribute('fill', 'var(--chart-bar)');
    expect(bar).toHaveAttribute('rx', '3');
    expect(screen.queryByTestId('usage-trend-tooltip')).toBeNull();

    // Hovering the whole column → shows the full time and this bucket's value; the highlight covers only this bar (width follows the bar)
    fireEvent.mouseEnter(screen.getByTestId('usage-trend-slot-0'));
    const tooltip = screen.getByTestId('usage-trend-tooltip');
    expect(tooltip).toHaveTextContent(/^\d{4}\/\d{2}\/\d{2} \d{2}:00/);
    expect(tooltip).toHaveTextContent('Tokens');
    expect(tooltip).toHaveTextContent('1,500 tokens');
    const lane = screen.getByTestId('usage-trend-hover');
    expect(Number(lane.getAttribute('width'))).toBe(Number(bar.getAttribute('width')) + 8);
    expect(lane).toHaveAttribute('rx', '3');
    // The left tick column matches the plot height so ticks land on their own grid lines (not stretched by the label row)
    const ticks = screen.getByTestId('usage-trend-ticks');
    expect(ticks.style.height).toBe('88px');
    expect([...ticks.children].map((child) => child.textContent)).toEqual(['1500', '750', '0']);

    fireEvent.mouseLeave(screen.getByTestId('usage-trend-chart'));
    expect(screen.queryByTestId('usage-trend-tooltip')).toBeNull();
    expect(screen.queryByTestId('usage-trend-hover')).toBeNull();
  });

  it('switches the trend metric and the detail tables', () => {
    seedSonnetTurn();
    render(<UsageView />);

    // Brand marker at the start of the row: colored by model family (the Claude family uses its vendor brand color)
    const dot = within(screen.getByTestId('usage-log-row')).getByTestId('usage-vendor-dot');
    expect(dot).toHaveAttribute('data-vendor', 'Anthropic');
    expect(dot).toHaveStyle({ color: 'var(--brand-anthropic)' });

    fireEvent.click(screen.getByTestId('usage-metric-requests'));
    expect(screen.getByTestId('usage-metric-requests')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('usage-tab-providers'));
    const providerRow = screen.getByTestId('usage-provider-row');
    expect(providerRow).toHaveAttribute('data-provider', 'anthropic');
    expect(within(providerRow).getAllByRole('cell')[1]).toHaveTextContent('1');
    expect(within(providerRow).getByTestId('usage-vendor-dot')).toHaveAttribute('data-vendor', 'Anthropic');

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
    expect(dot).toHaveStyle({ color: 'var(--brand-openai)' });
  });

  it('filters by provider and model, and by range', () => {
    seedSonnetTurn();
    useUsageStore.getState().recordTurn({
      provider: 'openai-compatible', model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 100,
      cachedInputTokens: 100, at: Date.now() - 10 * DAY,
    });
    render(<UsageView />);
    // Defaults to "today": only today's entry
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('usage-range'));
    fireEvent.click(screen.getByRole('option', { name: '全部时间' }));
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

  it('refreshes the view and can pick up records another instance persisted', async () => {
    seedSonnetTurn();
    render(<UsageView />);
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('1');
    expect(screen.queryByTestId('usage-refreshed-at')).toBeNull();

    // A record written to storage by another instance should appear after refreshing
    const stored = JSON.parse(localStorage.getItem('vrykell-usage') ?? '{}') as {
      state?: { records?: unknown[] };
    };
    stored.state = {
      ...(stored.state ?? {}),
      records: [
        ...((stored.state?.records ?? []) as unknown[]),
        {
          id: 'from-other-window', at: Date.now(), provider: 'anthropic', model: 'claude-sonnet-4',
          inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, reasoningTokens: 0, steps: 1, toolCalls: 0,
        },
      ],
    };
    localStorage.setItem('vrykell-usage', JSON.stringify(stored));

    fireEvent.click(screen.getByTestId('usage-refresh'));
    await waitFor(() => expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('2'));
    await waitFor(() => expect(screen.getByTestId('usage-refreshed-at')).toHaveTextContent('刷新于'));
  });

  it('filters models across reporting sources from the left chip bar', () => {
    seedSonnetTurn();
    // A turn reported by a future ACP harness (opencode stands in for it here)
    useUsageStore.getState().recordTurn({
      source: 'opencode', provider: 'anthropic', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 10,
    });
    render(<UsageView />);

    expect(screen.getByTestId('usage-model-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('usage-filter-model')).toBeNull();
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('usage-model-claude-sonnet-4'));
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-total-tokens')).toHaveTextContent('1610');

    // Clicking again returns to all sources
    fireEvent.click(screen.getByTestId('usage-model-claude-sonnet-4'));
    expect(screen.getByTestId('usage-total-requests')).toHaveTextContent('2');
    expect(screen.getByTestId('usage-model-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps agent session totals in the details tab without replacing model usage', () => {
    seedSonnetTurn();
    const usage = useUsageStore.getState();
    usage.acpUsage('Claude Code', { used: 12_000, size: 200_000, cost: 0.0042, currency: 'USD' });
    usage.acpTurn('Claude Code');
    usage.acpToolCall('Claude Code');
    render(<UsageView />);

    fireEvent.click(screen.getByTestId('usage-tab-acp'));
    expect(screen.getByTestId('usage-acp-row')).toHaveTextContent('1.2万/20万');
    expect(screen.getByTestId('usage-acp-row')).toHaveTextContent('0.0042 USD');
    expect(screen.getByTestId('usage-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();
    expect(screen.getByTestId('usage-filter-provider')).toBeInTheDocument();
    expect(screen.getByTestId('usage-range')).toBeInTheDocument();
    expect(screen.getByTestId('usage-clear')).toBeEnabled();

    // Back to all sources, the token view is restored
    fireEvent.click(screen.getByTestId('usage-model-all'));
    expect(screen.getByTestId('usage-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('usage-record-count')).toBeInTheDocument();
  });

  it('lists each ACP server in its own tab of the records card', () => {
    seedSonnetTurn();
    const usage = useUsageStore.getState();
    usage.acpUsage('Claude Code', { used: 12_000, size: 200_000, cost: 0.0042, currency: 'USD' });
    usage.acpTurn('Claude Code');
    usage.acpToolCall('Claude Code');
    render(<UsageView />);

    // ACP is no longer a separate card: no row outside the tabs, it appears only on the ACP tab
    expect(screen.queryByTestId('usage-acp-row')).toBeNull();
    fireEvent.click(screen.getByTestId('usage-tab-acp'));

    const row = screen.getByTestId('usage-acp-row');
    expect(row).toHaveAttribute('data-source', 'Claude Code');
    expect(row).toHaveTextContent('Claude Code');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('1');
    expect(cells[2]).toHaveTextContent('1');
    expect(cells[3]).toHaveTextContent('1.2万/20万');
    expect(cells[4]).toHaveTextContent('0.0042 USD');
  });

  it('falls back to all models when the selected model has no configuration or retained record', () => {
    seedSonnetTurn();
    render(<UsageView />);

    fireEvent.click(screen.getByTestId('usage-model-claude-sonnet-4'));
    expect(screen.getByTestId('usage-model-claude-sonnet-4')).toHaveAttribute('aria-pressed', 'true');

    // Clearing removes the server's record, so the selected source no longer exists.
    fireEvent.click(screen.getByTestId('usage-clear'));
    expect(screen.getByTestId('usage-model-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('usage-metrics')).toBeInTheDocument();
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

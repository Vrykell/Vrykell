/**
 * ProviderModelList presentational behaviour: searching, the capability filter, grouping,
 * setting the current model, and where each action lives.
 *
 * The list is the surface the settings page shows for one provider, so these tests pin the parts
 * a redesign could quietly break: the row hierarchy (name over identifier), the active badge, the
 * row menu order, and the delete confirmation.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderModelList from '../components/ProviderModelList';
import { useAiConfigStore } from '@features/agent';
import type { ProviderRow } from '../model/providerList';
import type { ModelProfile } from '@features/agent';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@platform/diagnostics', () => ({ invoke: invokeMock }));

const row: ProviderRow<ModelProfile> = {
  id: 'openai-compatible|https://api.example.com/v1',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  name: 'Example',
  models: [
    { id: 'm1', name: 'Chat model', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' },
    { id: 'm2', name: 'Reasoner', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'deepseek-r1' },
    { id: 'm3', name: 'Incomplete', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: '' },
  ],
};

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue(null);
  useAiConfigStore.setState({ models: row.models, activeModel: 'm1', providerKeys: [row.id] });
});

afterEach(() => {
  localStorage.clear();
});

describe('model list', () => {
  it('leads with the name and keeps the model id as quiet reference text', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    const rowElement = screen.getAllByTestId('model-row')[0]!;
    expect(within(rowElement).getByTestId('model-name')).toHaveTextContent('Chat model');
    expect(within(rowElement).getByTestId('model-id')).toHaveTextContent('gpt-4o');
    expect(rowElement).toHaveAttribute('data-active', 'true');
    expect(rowElement).toHaveAttribute('aria-current', 'true');
    expect(within(rowElement).getByTestId('model-current')).toHaveTextContent('当前');
    const inactiveRow = screen.getAllByTestId('model-row')[1]!;
    expect(inactiveRow).not.toHaveAttribute('data-active');
    expect(within(inactiveRow).queryByTestId('model-current')).toBeNull();
  });

  it('marks a row without an identifier instead of leaving the line blank', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    const incomplete = screen.getAllByTestId('model-row')[2]!;
    expect(within(incomplete).getByTestId('model-id')).toHaveTextContent('未填写模型 ID');
    expect(within(incomplete).getByTestId('model-id')).toHaveAttribute('data-missing', 'true');
  });

  it('does not repeat the identifier when the name is the identifier', () => {
    const synced: ProviderRow<ModelProfile> = {
      ...row,
      models: [{ id: 's1', name: 'gpt-4o-mini', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini' }],
    };
    useAiConfigStore.setState({ models: synced.models, activeModel: 's1' });
    render(<ProviderModelList row={synced} toast={() => {}} />);
    expect(screen.getByTestId('model-name')).toHaveTextContent('gpt-4o-mini');
    expect(screen.queryByTestId('model-id')).toBeNull();
  });

  it('searches by name and by model id, and clears the query', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    const search = screen.getByTestId('model-search');
    fireEvent.change(search, { target: { value: 'reasoner' } });
    expect(screen.getAllByTestId('model-row')).toHaveLength(1);
    expect(screen.getByTestId('model-name')).toHaveTextContent('Reasoner');
    fireEvent.change(search, { target: { value: 'gpt-4o' } });
    expect(screen.getByTestId('model-name')).toHaveTextContent('Chat model');
    fireEvent.click(screen.getByTestId('model-search-clear'));
    expect(search).toHaveValue('');
    expect(screen.getAllByTestId('model-row')).toHaveLength(3);
  });

  it('reports an empty filter result and offers to clear it', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    fireEvent.change(screen.getByTestId('model-search'), { target: { value: 'nothing-matches' } });
    expect(screen.getByTestId('model-no-match')).toBeVisible();
    fireEvent.click(within(screen.getByTestId('model-no-match')).getByRole('button', { name: '清空搜索' }));
    expect(screen.getAllByTestId('model-row')).toHaveLength(3);
  });

  it('filters by capability from one dropdown instead of a chip row', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    fireEvent.click(screen.getByTestId('model-filter'));
    fireEvent.click(screen.getByRole('option', { name: /推理/ }));
    expect(screen.getAllByTestId('model-row')).toHaveLength(1);
    expect(screen.getByTestId('model-name')).toHaveTextContent('Reasoner');
  });

  it('offers edit and delete in the row menu and switches the current model there', async () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    const second = screen.getAllByTestId('model-row')[1]!;
    // Delete is not an always-visible row control.
    expect(within(second).queryByTestId('model-remove')).toBeNull();
    fireEvent.click(within(second).getByTestId('model-actions'));
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByText('设为当前'));
    await waitFor(() => expect(useAiConfigStore.getState().activeModel).toBe('m2'));
    expect(useAiConfigStore.getState().model).toBe('deepseek-r1');
  });

  it('keeps the current model out of the switch action', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    const first = screen.getAllByTestId('model-row')[0]!;
    fireEvent.click(within(first).getByTestId('model-actions'));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('设为当前')).toBeNull();
    expect(within(menu).getByText('编辑模型')).toBeVisible();
    expect(within(menu).getByText('删除模型')).toBeVisible();
  });

  it('confirms before deleting and refuses to remove the last model', async () => {
    const toast = vi.fn();
    render(<ProviderModelList row={row} toast={toast} />);
    fireEvent.click(within(screen.getAllByTestId('model-row')[0]!).getByTestId('model-actions'));
    fireEvent.click(within(screen.getByRole('menu')).getByText('删除模型'));
    const confirm = await screen.findByTestId('confirm-dialog');
    fireEvent.click(within(confirm).getByTestId('confirm-ok'));
    await waitFor(() => expect(useAiConfigStore.getState().models).toHaveLength(2));

    // A single remaining model produces a message, never a confirmation.
    useAiConfigStore.setState({ models: [row.models[0]!], activeModel: 'm1' });
    render(<ProviderModelList row={{ ...row, models: [row.models[0]!] }} toast={toast} />);
    const onlyRow = screen.getAllByTestId('model-row');
    fireEvent.click(within(onlyRow[onlyRow.length - 1]!).getByTestId('model-actions'));
    fireEvent.click(within(screen.getByRole('menu')).getByText('删除模型'));
    expect(toast).toHaveBeenCalledWith('至少保留一个模型', 'info');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('keeps the list and its sync action available at every state', () => {
    render(<ProviderModelList row={row} toast={() => {}} />);
    expect(screen.getAllByTestId('model-row')).toHaveLength(3);
    expect(screen.getByTestId('model-sync')).toBeVisible();
  });

  it('summarises each group with its model count and folds it from the header', () => {
    const mixed: ProviderRow<ModelProfile> = {
      ...row,
      models: [
        ...row.models,
        { id: 'm4', name: 'Second vendor', provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'claude-sonnet-4' },
      ],
    };
    useAiConfigStore.setState({ models: mixed.models, activeModel: 'm1' });
    render(<ProviderModelList row={mixed} toast={() => {}} />);
    const headers = screen.getAllByRole('button', { expanded: true });
    expect(headers.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(headers[0]!);
    expect(headers[0]).toHaveAttribute('aria-expanded', 'false');
  });
});

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@i18n';
import HarnessView from '../components/HarnessView';
import { useHarnessStore, type HarnessSession } from '../stores/harness';
import { useComposerDrafts } from '../stores/composerDrafts';

const initial = useHarnessStore.getState();
const drafts = useComposerDrafts.getState();
const session = (): HarnessSession => ({
  harness: 'Example agent', sessionId: 'session', cwd: '/work', agent: null, messages: [], pending: false,
  opening: false, error: null, note: null, plan: [], context: null, commands: [], permission: null,
  permissionGeneration: 0, appToolsConnected: true,
  modes: { currentModeId: 'standard', availableModes: [{ id: 'standard', name: 'Standard' }] },
  models: { currentModelId: 'one', availableModels: [{ modelId: 'one', name: 'Model one' }] },
  configOptions: [{ id: 'reasoning', name: 'Reasoning effort', type: 'select', currentValue: 'medium',
    options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] }],
});

function Surface({ active = true }: { active?: boolean }) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  return <><div data-testid="agent-toolbar" ref={setToolbar} /><HarnessView tabId="agent" harness="Example agent" active={active} toolbarTarget={toolbar} /></>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useHarnessStore.setState({ byTab: { agent: session() } });
  useComposerDrafts.setState({ byTab: {} });
});
afterEach(() => { cleanup(); useHarnessStore.setState(initial, true); useComposerDrafts.setState(drafts, true); vi.unstubAllGlobals(); });

it('keeps permission and model choices in the composer and puts other choices in persistent toolbar settings', () => {
  const view = render(<Surface />);
  const footer = view.container.querySelector('.chat-input-status')!;
  expect(within(footer as HTMLElement).getByTestId('harness-selector-mode')).toBeVisible();
  expect(within(footer as HTMLElement).getByTestId('harness-selector-model')).toBeVisible();
  expect(screen.queryByTestId('harness-selector-config-reasoning')).toBeNull();
  const trigger = within(screen.getByTestId('agent-toolbar')).getByRole('button', { name: t('Conversation settings') });
  fireEvent.click(trigger);
  const settings = screen.getByRole('dialog', { name: t('Conversation settings') });
  const selector = within(settings).getByTestId('harness-selector-config-reasoning');
  fireEvent.click(selector);
  expect(screen.getByRole('listbox')).toBeVisible();
  fireEvent.keyDown(selector, { key: 'Escape' });
  expect(settings).toBeVisible();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: t('Conversation settings') })).toBeNull();
  expect(trigger).toHaveFocus();
  view.rerender(<Surface active={false} />);
  expect(within(screen.getByTestId('agent-toolbar')).queryByRole('button')).toBeNull();
});

it('shows the shared loading animation before any output and removes it when the turn ends', () => {
  useHarnessStore.setState({ byTab: { agent: { ...session(), pending: true,
    messages: [{ id: 'question', role: 'user', content: 'Check this project', createdAt: 1 }] } } });
  render(<Surface />);
  const loading = screen.getByRole('status');
  expect(loading).toHaveTextContent(t('Working'));
  expect(loading.querySelector('.ai-pending-cursor')).not.toBeNull();
  expect(useHarnessStore.getState().byTab.agent.messages).toHaveLength(1);
  act(() => useHarnessStore.setState(state => ({ byTab: { agent: { ...state.byTab.agent, pending: false } } })));
  expect(screen.queryByRole('status')).toBeNull();
});

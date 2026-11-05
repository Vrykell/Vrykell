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
afterEach(() => { cleanup(); useHarnessStore.setState(initial, true); useComposerDrafts.setState(drafts, true); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it('renders a pending question above the working row', () => {
  useHarnessStore.setState({ byTab: { agent: { ...session(), pending: true,
    messages: [{ id: 'question', role: 'user', content: 'Check this project', createdAt: 1 }],
    questions: [{ requestId: 'pending-question', form: { message: 'Choose the next step', fields: [
      { key: 'choice', title: 'Choice', description: '', kind: 'string', required: false, options: [], default: '',
        minimum: null, maximum: null, minLength: 0, maxLength: 100, minItems: 0, maxItems: 0 },
    ] } }] } } });
  const view = render(<Surface />);
  const question = view.container.querySelector('.ai-user-question');
  const working = view.container.querySelector('.ai-block-working');
  expect(question).not.toBeNull();
  expect(working).not.toBeNull();
  expect(question!.compareDocumentPosition(working!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('grows the composer with its content the way the other composers do', () => {
  vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => 400);
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
    return 22 * Math.max(1, this.value.split('\n').length);
  });
  useComposerDrafts.getState().setText('agent', 'one');
  render(<Surface />);
  const composer = screen.getByTestId('harness-composer') as HTMLTextAreaElement;
  expect(composer.style.height).toBe('22px');
  fireEvent.change(composer, { target: { value: 'one\ntwo\nthree' } });
  expect(composer.style.height).toBe('66px');
  expect(composer.style.overflowY).toBe('hidden');
  // Beyond the shared cap the box stops growing and scrolls internally, like the AI panel.
  fireEvent.change(composer, { target: { value: Array.from({ length: 8 }, () => 'line').join('\n') } });
  expect(composer.style.height).toBe('120px');
  expect(composer.style.overflowY).toBe('auto');
});

it('keeps the draft when a prompt cannot be accepted', async () => {
  useHarnessStore.setState({ prompt: vi.fn(async () => false) });
  useComposerDrafts.getState().setText('agent', 'Keep this question');
  render(<Surface />);
  await act(async () => { fireEvent.click(screen.getByTestId('harness-send')); });
  expect(screen.getByTestId('harness-composer')).toHaveValue('Keep this question');
});

it('preserves newly typed text while accepting a pending send only once', async () => {
  let finish!: (accepted: boolean) => void;
  const prompt = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  useHarnessStore.setState({ prompt });
  useComposerDrafts.getState().setText('agent', 'Original question');
  render(<Surface />);
  fireEvent.click(screen.getByTestId('harness-send'));
  fireEvent.click(screen.getByTestId('harness-send'));
  fireEvent.change(screen.getByTestId('harness-composer'), { target: { value: 'Next question' } });
  await act(async () => { finish(true); });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('harness-composer')).toHaveValue('Next question');
});

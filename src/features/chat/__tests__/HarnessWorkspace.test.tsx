import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HarnessWorkspace from '../components/HarnessWorkspace';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useSessionStore, useUiStore } from '@features/workspace';

vi.mock('../components/HarnessView', () => ({ default: ({ active }: { active: boolean }) => <input aria-label="Agent draft" data-active={active} defaultValue="" /> }));
vi.mock('@features/agent/components/UsageView', () => ({ default: () => <div>Usage page</div> }));
const workspace = useSessionStore.getState(); const harness = useHarnessWorkspace.getState(); const ai = useAiWorkspace.getState();
afterEach(() => { cleanup(); useSessionStore.setState(workspace, true); useHarnessWorkspace.setState(harness, true); useAiWorkspace.setState(ai, true); });

it('keeps conversation history available on the empty start page', () => {
  useHarnessWorkspace.setState({ connections: [], selected: '' });
  useAiWorkspace.setState({ nativeTabs: [], selected: '' });
  useSessionStore.getState().ensureStartPages();
  render(<HarnessWorkspace active />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 对话历史' }));
  expect(useSessionStore.getState().tabs.some(tab => tab.kind === 'ai-history')).toBe(true);
});

it('hides the connected session behind a system page without dropping its draft or remounting', () => {
  useUiStore.setState({ settingsOpen: false });
  useHarnessWorkspace.setState({ connections: [{ id: 'agent', harness: 'Agent', cwd: '', fresh: false }], selected: 'agent' });
  useAiWorkspace.setState({ nativeTabs: [], selected: 'acp:agent' });
  useSessionStore.getState().openHarnessTab(); const harnessPage = useSessionStore.getState().activeId!;
  render(<HarnessWorkspace active />);
  const draft = screen.getByRole('textbox', { name: 'Agent draft' });
  fireEvent.change(draft, { target: { value: 'unfinished work' } });
  act(() => useSessionStore.getState().openUsageTab());
  expect(screen.getByText('Usage page')).toBeVisible();
  expect(draft).not.toBeVisible(); expect(draft).toHaveAttribute('data-active', 'false');
  act(() => useSessionStore.getState().activate(harnessPage));
  expect(screen.getByRole('textbox', { name: 'Agent draft' })).toBe(draft);
  expect(draft).toBeVisible(); expect(draft).toHaveValue('unfinished work');
});

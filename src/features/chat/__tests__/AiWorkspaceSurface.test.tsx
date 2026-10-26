import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import AiWorkspaceSurface, { AiWorkspaceProvider } from '../components/AiWorkspaceSurface';
import NativeConversationSurface from '../components/NativeConversationSurface';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { ResourceContentProvider } from '@ui/layout/ResourceContent';

const lifecycle = vi.hoisted(() => ({ mounts: 0, stops: 0, renders: 0, harnessRenders: 0 }));
vi.mock('../components/HarnessWorkspace', () => ({ default: () => {
  lifecycle.harnessRenders += 1;
  return <><span data-testid="connected-session">Connected session</span><NativeConversationSurface /></>;
} }));
vi.mock('../components/PanelChat', () => ({ default: function Conversation({ conversationId, workspace }: { conversationId: string; workspace: boolean }) {
  lifecycle.renders += 1;
  const [draft, setDraft] = useState('');
  useEffect(() => { lifecycle.mounts += 1; return () => { lifecycle.stops += 1; }; }, []);
  return <input aria-label="Draft" data-conversation={conversationId} data-workspace={workspace} value={draft} onChange={event => setDraft(event.target.value)} />;
} }));
const ai = useAiWorkspace.getState();
const chat = useChatStore.getState();
beforeEach(() => { useAiWorkspace.setState({ nativeTabs: ['native'], selected: 'chat:native', sideSelected: '' }); useChatStore.setState({ activeConversationId: 'native' }); });
afterEach(() => { cleanup(); lifecycle.mounts = 0; lifecycle.stops = 0; lifecycle.renders = 0; lifecycle.harnessRenders = 0; useAiWorkspace.setState(ai, true); useChatStore.setState(chat, true); });

it('keeps each open native conversation mounted independently while the selection changes', () => {
  useAiWorkspace.setState({ nativeTabs: ['native', 'other'], selected: 'chat:native' });
  render(<AiWorkspaceProvider placement="main" mainActive headerActive sideActive={false}><AiWorkspaceSurface placement="main" /></AiWorkspaceProvider>);
  const first = document.querySelector<HTMLInputElement>('[data-conversation="native"]')!;
  fireEvent.change(first, { target: { value: 'First draft' } });
  act(() => { useChatStore.setState({ activeConversationId: 'other' }); useAiWorkspace.setState({ selected: 'chat:other' }); });
  const second = document.querySelector<HTMLInputElement>('[data-conversation="other"]')!;
  fireEvent.change(second, { target: { value: 'Second draft' } });
  act(() => { useChatStore.setState({ activeConversationId: 'native' }); useAiWorkspace.setState({ selected: 'chat:native' }); });
  expect(document.querySelector('[data-conversation="native"]')).toBe(first); expect(first).toHaveValue('First draft'); expect(second).toHaveValue('Second draft');
  expect(lifecycle.mounts).toBe(2); expect(lifecycle.stops).toBe(0);
});

it('does not rerender connected or native content when an unrelated layout width changes', () => {
  function Layout() {
    const [width, setWidth] = useState(200);
    return <AiWorkspaceProvider placement="main" mainActive headerActive sideActive={false}>
      <button onClick={() => setWidth(value => value + 10)}>Resize</button>
      <div style={{ width }}><AiWorkspaceSurface placement="main" /><AiWorkspaceSurface placement="side" /></div>
    </AiWorkspaceProvider>;
  }
  render(<Layout />);
  const renders = lifecycle.renders;
  const harnessRenders = lifecycle.harnessRenders;
  for (let index = 0; index < 10; index += 1) fireEvent.click(screen.getByText('Resize'));
  expect(lifecycle.renders).toBe(renders);
  expect(lifecycle.harnessRenders).toBe(harnessRenders);
  expect(lifecycle.mounts).toBe(1);
});

it('moves the existing conversation node without restarting it or dropping local state', () => {
  const view = (placement: 'main' | 'side') => <ResourceContentProvider><AiWorkspaceProvider placement={placement} mainActive headerActive sideActive={placement === 'side'}>
    <AiWorkspaceSurface placement="main" /><AiWorkspaceSurface placement="side" />
  </AiWorkspaceProvider></ResourceContentProvider>;
  const { rerender, unmount } = render(view('main'));
  const input = screen.getByRole('textbox', { name: 'Draft' });
  const connected = screen.getByTestId('connected-session');
  fireEvent.change(input, { target: { value: 'Unsent work' } });
  expect(input.closest('[data-testid="ai-surface-main"]')).not.toBeNull();
  act(() => { useAiWorkspace.getState().selectSide('chat:native'); useAiWorkspace.getState().select(''); rerender(view('side')); });
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(input).toHaveValue('Unsent work');
  expect(input.closest('[data-testid="ai-surface-side"]')).not.toBeNull();
  expect(screen.getByTestId('connected-session')).toBe(connected);
  expect(connected.closest('[data-testid="ai-surface-main"]')).not.toBeNull();
  act(() => { useAiWorkspace.getState().openNative('native'); rerender(view('main')); });
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(lifecycle.mounts).toBe(1);
  expect(lifecycle.stops).toBe(0);
  unmount(); expect(lifecycle.stops).toBe(1);
});

it('opens and reopens an independent sidebar without moving the main conversation', () => {
  useChatStore.setState({ conversationsLoaded: true, conversations: [{ id: 'native', title: 'Main', createdAt: 1, updatedAt: 1, environment: null }], byTab: { native: [] } });
  const view = (sideActive: boolean) => <ResourceContentProvider><AiWorkspaceProvider placement={sideActive ? 'side' : 'main'} mainActive headerActive sideActive={sideActive}>
    <AiWorkspaceSurface placement="main" /><AiWorkspaceSurface placement="side" />
  </AiWorkspaceProvider></ResourceContentProvider>;
  const { rerender } = render(view(false));
  const main = document.querySelector<HTMLInputElement>('[data-conversation="native"]')!;
  fireEvent.change(main, { target: { value: 'Main draft' } });
  act(() => rerender(view(true)));
  const sideId = useAiWorkspace.getState().sideSelected.slice(5);
  expect(sideId).not.toBe('native');
  expect(main.closest('[data-testid="ai-surface-main"]')).not.toBeNull();
  expect(main).toHaveAttribute('data-workspace', 'true');
  const side = document.querySelector<HTMLInputElement>(`[data-conversation="${sideId}"]`)!;
  fireEvent.change(side, { target: { value: 'Side draft' } });
  act(() => rerender(view(false)));
  act(() => rerender(view(true)));
  expect(useAiWorkspace.getState().sideSelected).toBe(`chat:${sideId}`);
  expect(main).toHaveValue('Main draft'); expect(side).toHaveValue('Side draft');
  expect(main).toHaveAttribute('data-workspace', 'true');
  expect(main.closest('[data-testid="ai-surface-main"]')).not.toBeNull();
});

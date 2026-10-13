import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@features/workspace';
import { leaf } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import { useChatStore } from '../stores/chat';
import { useComposerDrafts } from '../stores/composerDrafts';
import PanelChat from '../components/PanelChat';

vi.mock('@platform/api/conversation', () => ({
  listConversations: vi.fn().mockResolvedValue([]), saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversationMessages: vi.fn().mockResolvedValue([]), appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined), deleteConversationMessage: vi.fn().mockResolvedValue(undefined),
}));
const workspace = useSessionStore.getState();
const terminal = useTerminalStore.getState();
const chat = useChatStore.getState();
const drafts = useComposerDrafts.getState();
const paneId = 'chat-tab#0';
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '会话设置' }));

beforeEach(() => {
  useSessionStore.setState({ tabs: [{ id: 'chat-tab', title: 'Build', kind: 'session', layout: leaf({ id: paneId, kind: 'local', shellType: 'bash', cwd: '/work' }) }], activeId: 'chat-tab', terminalCwds: {} });
  useTerminalStore.setState({ focusedPaneId: paneId, sessions: { [paneId]: 'pty-chat' } });
  useChatStore.setState({ conversationsLoaded: true, activeConversationId: 'conversation', conversations: [{ id: 'conversation', title: 'Build issue', createdAt: 1, updatedAt: 1, environment: null }], byTab: { conversation: [] } });
});
afterEach(() => {
  cleanup(); useSessionStore.setState(workspace, true); useTerminalStore.setState(terminal, true);
  useChatStore.setState(chat, true); useComposerDrafts.setState(drafts, true);
});

it('allows discussion without implicitly binding the focused terminal', () => {
  render(<PanelChat />);
  expect(screen.queryByTestId('chat-context-usage')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '选择执行终端' })).not.toBeInTheDocument();
  openSettings();
  expect(screen.getByRole('combobox', { name: '选择执行终端' })).toHaveTextContent('仅讨论');
  expect(screen.getByRole('combobox', { name: '选择执行终端' })).toBeInTheDocument();
  expect(screen.queryByTestId('chat-environment-chip')).not.toBeInTheDocument();
  expect(useChatStore.getState().conversations[0]?.environment).toBeNull();
  expect(screen.getByRole('button', { name: '添加附件' })).toBeInTheDocument();
  expect(screen.getByTestId('chat-approval-select')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('自然语言描述你想做什么…'), { target: { value: 'Explain the build' } });
  expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
});

it('keeps the same draft and title when the workspace switches to settings', () => {
  render(<PanelChat />);
  fireEvent.change(screen.getByPlaceholderText('自然语言描述你想做什么…'), { target: { value: 'Unfinished question' } });
  act(() => useSessionStore.setState({ activeId: 'settings', tabs: [{ id: 'settings', title: 'Settings', kind: 'settings' }] }));
  expect(screen.getByPlaceholderText('自然语言描述你想做什么…')).toHaveValue('Unfinished question');
  expect(screen.getByText('Build issue')).toBeInTheDocument();
});

it('isolates new conversation drafts and opens singleton history in the workspace', () => {
  render(<PanelChat />);
  fireEvent.change(screen.getByPlaceholderText('自然语言描述你想做什么…'), { target: { value: 'First draft' } });
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByPlaceholderText('自然语言描述你想做什么…')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'AI 对话历史' }));
  expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'AI 对话历史' }));
  expect(useSessionStore.getState().tabs.filter(tab => tab.kind === 'ai-history')).toHaveLength(1);
  expect(screen.getByPlaceholderText('自然语言描述你想做什么…')).toHaveValue('');
});

it('reuses the workspace inline rename input treatment', () => {
  render(<PanelChat />);
  fireEvent.click(screen.getByRole('button', { name: '重命名对话' }));
  expect(screen.getByRole('textbox', { name: '对话标题' })).toHaveClass('inline-rename-input');
});

it('keeps terminal settings above and orders attachment, approval, model and send in one footer', () => {
  useComposerDrafts.getState().updateAttachments('conversation', () => [
    { id: 'file', kind: 'file', name: 'notes.md', mime: 'text/plain', size: 10, textContent: 'notes' },
    { id: 'image', kind: 'image', name: 'screen.png', mime: 'image/png', size: 10 },
  ]);
  const { container } = render(<PanelChat />);
  const heading = container.querySelector('.chat-conversation-heading')!;
  expect(within(heading as HTMLElement).queryByRole('button', { name: '对话与审批模式' })).not.toBeInTheDocument();
  expect(heading.querySelector('[data-testid="model-pill"]')).toBeNull();
  expect(within(heading as HTMLElement).getByRole('button', { name: '新对话' })).toBeInTheDocument();
  expect(within(heading as HTMLElement).getByRole('button', { name: 'AI 对话历史' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '发送' }).closest('.chat-input-status')).not.toBeNull();
  expect(screen.getByRole('button', { name: '添加附件' }).closest('.chat-input-status')).not.toBeNull();
  expect(container.querySelector('.chat-composer-input button')).toBeNull();
  expect(container.querySelector('.terminal-composer-heading .composer-key-hints')).toHaveTextContent('发送');
  expect(container.querySelectorAll('.chat-input-status button')).toHaveLength(4);
  const footer = container.querySelector('.chat-input-status')!;
  expect(Array.from(footer.querySelectorAll('button')).map(button => button.getAttribute('aria-label')))
    .toEqual(['添加附件', '对话与审批模式', '切换模型', '发送']);
  openSettings();
  const settings = screen.getByRole('region', { name: '会话设置' });
  expect(screen.getByRole('button', { name: '对话与审批模式' }).closest('.chat-input-status')).not.toBeNull();
  expect(within(settings).queryByTestId('model-pill')).not.toBeInTheDocument();
  const tray = container.querySelector('.chat-context-tray')!;
  const input = container.querySelector('[data-chat-composer]')!;
  expect(tray.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(tray as HTMLElement).getByText('notes.md')).toBeInTheDocument();
  expect(within(tray as HTMLElement).getByText('screen.png')).toBeInTheDocument();
  expect(within(settings).getByRole('combobox', { name: '选择执行终端' })).toBeInTheDocument();
  expect(within(settings).queryByRole('button', { name: '新对话' })).not.toBeInTheDocument();
  expect(within(settings).queryByRole('button', { name: 'AI 对话历史' })).not.toBeInTheDocument();
  fireEvent.keyDown(settings, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '会话设置' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '会话设置' })).toHaveFocus();
  expect(within(tray as HTMLElement).getByText('notes.md')).toBeInTheDocument();
});

it('switches and clears the target through conversation settings without losing the draft', () => {
  render(<PanelChat />);
  openSettings();
  const input = screen.getByPlaceholderText('自然语言描述你想做什么…');
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  const select = screen.getByRole('combobox', { name: '选择执行终端' });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: /Build/ }));
  expect(useChatStore.getState().conversations[0]?.environment?.paneId).toBe(paneId);
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: '仅讨论 · 不操作终端' }));
  expect(useChatStore.getState().conversations[0]?.environment).toBeNull();
  expect(input).toHaveValue('Keep this draft');
});

it('shows a concise server badge and retains its full host context in the picker', () => {
  useSessionStore.setState({ tabs: [{ id: 'chat-tab', title: 'Server', kind: 'session', layout: leaf({
    id: paneId, kind: 'ssh', ssh: { name: 'Production', host: '10.21.76.61' },
  }) }], terminalCwds: { [paneId]: '/srv/app' } });
  useChatStore.setState({ conversations: [{ id: 'conversation', title: 'Deploy', createdAt: 1, updatedAt: 1,
    environment: { paneId, label: 'Server · Production', kind: 'ssh', cwd: '/srv/app' } }] });
  render(<PanelChat />);
  expect(screen.getByTestId('chat-conversation-context')).toHaveTextContent('10.21.76.61');
  openSettings();
  const target = screen.getByRole('combobox', { name: '选择执行终端' });
  expect(target).toHaveTextContent('10.21.76.61');
  expect(target).not.toHaveTextContent('/srv/app');
  fireEvent.click(target);
  expect(screen.getByRole('option', { name: 'Server · Production · 10.21.76.61 · /srv/app' })).toBeInTheDocument();
});

it('keeps a disconnected target visible and never silently chooses another terminal', () => {
  useChatStore.setState({ conversations: [{ id: 'conversation', title: 'Build issue', createdAt: 1, updatedAt: 1,
    environment: { paneId: 'closed-terminal', label: 'Build terminal', kind: 'local', cwd: '/project' } }] });
  render(<PanelChat />);
  openSettings();
  expect(screen.getByTestId('chat-execution-target')).toHaveTextContent('Build terminal · 已断开');
  expect(screen.getByText('终端已断开，选择终端后可继续执行。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看终端' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('combobox', { name: '选择执行终端' }));
  const picker = screen.getByRole('listbox', { name: '选择执行终端' });
  expect(within(picker).getByRole('option', { name: '仅讨论 · 不操作终端' })).toBeInTheDocument();
  expect(within(picker).queryByRole('option', { name: /closed-terminal/ })).not.toBeInTheDocument();
  expect(useChatStore.getState().conversations[0]?.environment?.paneId).toBe('closed-terminal');
});

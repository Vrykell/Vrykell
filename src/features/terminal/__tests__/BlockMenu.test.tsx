import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BlockMenu from '../components/BlockMenu';
import { useChatStore } from '@features/chat';
import { useComposerDrafts } from '@features/chat/stores/composerDrafts';
import { useTerminalStore } from '../stores/terminal';
import type { TermBlock } from '../services/pipeline/termBlock';

const mocks = vi.hoisted(() => ({ write: vi.fn(), copy: vi.fn(), clear: vi.fn(), send: vi.fn() }));
vi.mock('@platform/pty', () => ({ ptyWrite: mocks.write }));
vi.mock('@platform/clipboard', () => ({ writeClipboardText: mocks.copy }));
vi.mock('../hooks/useTerminalSession', () => ({ clearSessionBlocks: mocks.clear }));

const block: TermBlock = {
  id: 'b1', command: 'git status', status: 'done', exitCode: 0, startedAt: 0, endedAt: 1400,
  wasLongRunning: false, outputHtml: '', outputText: 'clean', outputRaw: '', linesTruncated: 0,
};
const chat = useChatStore.getState();
const terminal = useTerminalStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(undefined);
  useChatStore.setState({ send: mocks.send });
  useTerminalStore.setState({ sessions: { pane: 'pty' } });
});
afterEach(() => {
  useChatStore.setState(chat, true);
  useTerminalStore.setState(terminal, true);
});

function open(output = 'clean') {
  const close = vi.fn();
  render(<BlockMenu block={block} paneId="pane" anchor={{ kind: 'pointer', x: 0, y: 0 }}
    onClose={close} getOutputText={() => output} />);
  return close;
}

describe('command action menu', () => {
  it.each([
    ['复制命令', 'git status'], ['复制输出', 'clean'],
  ])('copies the requested text through %s and closes', async (label, expected) => {
    const close = open();
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(expected));
    expect(close).toHaveBeenCalledOnce();
  });

  it('reruns through the owning pane', () => {
    const close = open();
    fireEvent.click(screen.getByRole('menuitem', { name: '重新运行' }));
    expect(mocks.write).toHaveBeenCalledWith('pty', 'git status\n');
    expect(close).toHaveBeenCalledOnce();
  });

  it('stages a bounded snapshot for review without automatically submitting it', () => {
    open('x'.repeat(3000));
    fireEvent.click(screen.getByRole('menuitem', { name: '发给 AI 分析' }));
    expect(mocks.send).not.toHaveBeenCalled();
    const id = useChatStore.getState().activeConversationId;
    expect(useComposerDrafts.getState().byTab[id]?.references?.[0]).toMatchObject({ paneId: 'pane', command: 'git status', output: 'x'.repeat(2000), exitCode: 0 });
  });

  it('clears only the selected pane and displays elapsed time starting at zero', () => {
    open();
    expect(screen.getByText('1.4s')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '清除所有块' }));
    expect(mocks.clear).toHaveBeenCalledWith('pane');
  });
});

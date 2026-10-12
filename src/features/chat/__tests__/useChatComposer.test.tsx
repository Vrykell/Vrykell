import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { useChatComposer } from '@features/chat/hooks/useChatComposer';

describe('useChatComposer', () => {
  const attachment: AttachmentMeta = {
    id: 'att-1',
    kind: 'file',
    name: 'readme.md',
    mime: 'text/markdown',
    size: 10,
    textContent: '# Vrykell',
  };

  it('cycles through matching questions and restores the original prefix', () => {
    const { result } = renderHook(() => useChatComposer({
      questions: ['git status', 'git log'],
      draft: '',
      setDraft: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      sending: false,
      isSession: true,
      targetPane: 'pane-1',
      attachments: [],
      clearAttachments: vi.fn(),
    }));

    act(() => result.current.setText('git'));
    act(() => result.current.navigateHistory(1));
    expect(result.current.text).toBe('git status');
    act(() => result.current.navigateHistory(1));
    expect(result.current.text).toBe('git log');
    act(() => result.current.navigateHistory(-1));
    expect(result.current.text).toBe('git status');
    act(() => result.current.navigateHistory(-1));
    expect(result.current.text).toBe('git');
  });

  it('submits text and attachments only when the session is ready', () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const clearAttachments = vi.fn();
    const { result, rerender } = renderHook(
      ({ sending }) => useChatComposer({
        questions: [],
        draft: '',
        setDraft: vi.fn(),
        send,
        sending,
        isSession: true,
        targetPane: 'pane-2',
        attachments: [attachment],
        clearAttachments,
      }),
      { initialProps: { sending: false } },
    );

    act(() => result.current.setText('  分析这个文件  '));
    act(() => result.current.submit());
    expect(send).toHaveBeenCalledWith('分析这个文件', { paneId: 'pane-2', attachments: [attachment] });
    expect(clearAttachments).toHaveBeenCalledOnce();
    expect(result.current.text).toBe('');

    rerender({ sending: true });
    act(() => result.current.setText('不应发送'));
    act(() => result.current.submit());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('restores a saved draft without moving focus into the chat composer', () => {
    const setDraft = vi.fn();
    function Harness() {
      const { inputRef, text, handleChange } = useChatComposer({
        questions: [],
        draft: 'saved draft',
        setDraft,
        send: vi.fn().mockResolvedValue(undefined),
        sending: false,
        isSession: true,
        targetPane: 'pane-1',
        attachments: [],
        clearAttachments: vi.fn(),
      });
      return <textarea ref={inputRef} aria-label="chat composer" value={text} onChange={handleChange} />;
    }

    render(<Harness />);

    const composer = screen.getByRole('textbox', { name: 'chat composer' });
    expect(composer).toHaveValue('saved draft');
    expect(composer).not.toHaveFocus();
    expect(setDraft).toHaveBeenCalledWith('');
  });
});

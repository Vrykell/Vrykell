import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
const executing = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useTerminalSession', () => ({ getExecutingTerm: executing }));
import { focusSessionInput } from '../services/terminalFocus';
import { termInstances, useTerminalStore } from '../stores/terminal';

function terminal(type: 'normal' | 'alternate') {
  const textarea = document.createElement('textarea');
  document.querySelector('[data-testid="pane-p1"]')!.append(textarea);
  return { textarea, buffer: { active: { type } }, focus: vi.fn(() => textarea.focus()) };
}

describe('session activation focus', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div data-testid="pane-p1"><textarea data-terminal-input></textarea></div>';
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      return (this.closest('[data-hidden]') ? [] : [{}]) as unknown as DOMRectList;
    });
    termInstances.clear();
    executing.mockReset();
    useTerminalStore.setState({ scenes: { p1: 'blockList' } });
  });

  it('moves focus from a tab button to the running block, and uses the main alternate buffer for TUI', () => {
    const button = document.createElement('button'); document.body.append(button); button.focus();
    const main = terminal('alternate'); const live = terminal('normal');
    termInstances.set('p1', main as unknown as Terminal);
    executing.mockReturnValue({ term: live });
    useTerminalStore.setState({ scenes: { p1: 'altScreen' } });
    focusSessionInput('p1');
    expect(main.textarea).toHaveFocus();
    expect(live.focus).not.toHaveBeenCalled();
    main.buffer.active.type = 'normal';
    focusSessionInput('p1');
    expect(live.textarea).toHaveFocus();
  });

  it('focuses command input instead of the chat composer, but never steals an open modal', () => {
    const command = document.querySelector('[data-terminal-input]')!;
    const chat = document.createElement('textarea'); chat.dataset.chatComposer = ''; document.body.append(chat);
    focusSessionInput('p1');
    expect(command).toHaveFocus();
    expect(chat).not.toHaveFocus();
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = '<input />'; document.body.append(dialog);
    focusSessionInput('p1'); expect(dialog.querySelector('input')).toHaveFocus();
  });

  it('keeps hidden sessions unfocused and respects SSH authentication input', () => {
    const pane = document.querySelector<HTMLElement>('[data-testid="pane-p1"]')!;
    pane.dataset.hidden = '';
    focusSessionInput('p1'); expect(document.activeElement).toBe(document.body);
    delete pane.dataset.hidden;
    const secret = document.createElement('input'); secret.className = 'ssh-auth-response'; pane.append(secret);
    focusSessionInput('p1'); expect(secret).toHaveFocus();
  });
  it('focuses an explicitly prepared command draft beside a classic terminal', () => {
    const main = terminal('normal');
    termInstances.set('p1', main as unknown as Terminal);
    useTerminalStore.setState({ scenes: { p1: 'classic' }, keyboardTarget: 'input' });
    focusSessionInput('p1');
    expect(document.querySelector('[data-terminal-input]')).toHaveFocus();
    expect(main.focus).not.toHaveBeenCalled();
  });
});

export interface VimKeyEvent {
  key: string;
  keyCode: number;
  browserEvent: { key: string; defaultPrevented: boolean };
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface VimKeyTarget {
  handleKeyDown: (event: VimKeyEvent) => void;
}

const specialKeys: Record<string, { key: string; keyCode: number }> = {
  '\r': { key: 'Enter', keyCode: 3 },
  '\n': { key: 'Enter', keyCode: 3 },
  '\t': { key: 'Tab', keyCode: 2 },
  '\b': { key: 'Backspace', keyCode: 1 },
  '\x1b': { key: 'Escape', keyCode: 9 },
};

function keyEvent(character: string): VimKeyEvent {
  const special = specialKeys[character];
  const key = special?.key ?? `'${character}'`;
  return {
    key,
    keyCode: special?.keyCode ?? 0,
    browserEvent: { key: character, defaultPrevented: false },
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

function appendToPrompt(input: HTMLInputElement, text: string) {
  input.value += text;
  const end = input.value.length;
  input.setSelectionRange(end, end);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  const last = Array.from(text).pop() ?? '';
  input.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true }));
}

function submitPrompt(input: HTMLInputElement) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { value: 13 });
  input.dispatchEvent(event);
}

/**
 * Replays committed composition text through the modal key map.
 *
 * Normal mode treats committed ASCII as commands, so a composition such as `:w` opens the
 * command line. Once the key map opens a prompt, the remaining text belongs to that prompt.
 */
export function replayVimText(adapter: VimKeyTarget, statusBar: HTMLElement | null, text: string) {
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index++) {
    const prompt = statusBar?.querySelector('input');
    if (prompt) {
      const rest = characters.slice(index).join('');
      const breakIndex = rest.search(/[\r\n]/);
      appendToPrompt(prompt, breakIndex === -1 ? rest : rest.slice(0, breakIndex));
      if (breakIndex !== -1) submitPrompt(prompt);
      return;
    }
    adapter.handleKeyDown(keyEvent(characters[index]!));
  }
}

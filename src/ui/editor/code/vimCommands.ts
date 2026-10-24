import type { editor } from 'monaco-editor';
import type { EditorVimCommand } from '@core/editor';
import { writeClipboardText } from '@platform/clipboard';
import { useToastStore } from '@ui/feedback/Toast';
import { t } from '@i18n';

interface Adapter { editor: editor.IStandaloneCodeEditor }
interface ExParameters { argString?: string; line?: number; lineEnd?: number }
interface Registers {
  pushText: (register: string, operator: string, text: string, linewise?: boolean, blockwise?: boolean) => void;
}
export interface VimApi {
  defineEx: (name: string, shorthand: string, callback: (adapter: Adapter, parameters: ExParameters) => void) => void;
  map: (from: string, to: string, mode: string) => void;
  getRegisterController?: () => Registers;
}
const handlers = new WeakMap<editor.IStandaloneCodeEditor, (command: EditorVimCommand) => void | Promise<unknown>>();
const registered = new WeakSet<VimApi>();
export function bindEditorVimCommands(view: editor.IStandaloneCodeEditor, handler: (command: EditorVimCommand) => void | Promise<unknown>) {
  handlers.set(view, handler);
  return () => { handlers.delete(view); };
}
export function registerEditorVimCommands(api: VimApi) {
  if (registered.has(api)) return;
  registered.add(api);
  const definitions: [string, string, EditorVimCommand['action']][] = [
    ['write', 'w', 'write'], ['quit', 'q', 'quit'], ['wq', 'wq', 'writeQuit'], ['xit', 'x', 'exit'],
    ['exit', 'exi', 'exit'], ['edit', 'e', 'reload'], ['bnext', 'bn', 'next'], ['bprevious', 'bp', 'previous'], ['bdelete', 'bd', 'delete'],
  ];
  for (const [name, shorthand, action] of definitions) api.defineEx(name, shorthand, (adapter, parameters = {}) => {
    const argumentsText = parameters.argString?.trim() ?? '';
    void Promise.resolve().then(() => handlers.get(adapter.editor)?.({ action, force: argumentsText.startsWith('!'),
      args: argumentsText.replace(/^!/, '').trim(), ranged: parameters.line !== undefined || parameters.lineEnd !== undefined }))
      .catch(() => useToastStore.getState().addToast(t('Could not complete the editor command.'), 'error'));
  });
  api.map?.('ZZ', ':x<CR>', 'normal'); api.map?.('ZQ', ':q!<CR>', 'normal');
  const registers = api.getRegisterController?.();
  if (registers) {
    const push = registers.pushText;
    registers.pushText = function(register, operator, text, linewise, blockwise) {
      push.call(this, register, operator, text, linewise, blockwise);
      if (operator === 'yank' && register !== '_') void writeClipboardText(linewise && !text.endsWith('\n') ? `${text}\n` : text)
        .catch(() => useToastStore.getState().addToast(t('Could not copy text to the clipboard.'), 'error'));
    };
  }
}

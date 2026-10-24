import { isMacOS } from '@platform/runtime';

const modifier = isMacOS ? 'Meta' : 'Control';
export const FILE_DIRECTORY_SHORTCUTS = {
  terminal: `${modifier}+Alt+L`,
  panel: `${modifier}+Alt+Shift+L`,
};

export function fileDirectoryShortcut(event: KeyboardEvent): 'terminal' | 'panel' | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat || !event.altKey || !(event.ctrlKey || event.metaKey)
    || event.getModifierState('AltGraph')
    || event.code !== 'KeyL' && event.key.toLowerCase() !== 'l') return null;
  return event.shiftKey ? 'panel' : 'terminal';
}

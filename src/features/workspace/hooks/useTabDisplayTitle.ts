import { isSessionTab, terminalsOf, useSessionStore, type Tab } from '@features/workspace/model/session/store';
import { resolveDisplayTitle } from '@features/workspace/model/sessionTitle';

/**
 * Effective title for a tab row and the window title.
 *
 * A running program's live title (set via OSC 0/2) is shown on top of the stored generated title,
 * while a manually renamed tab keeps its own name.
 */
export function useTabDisplayTitle(tab: Tab | undefined): string {
  const programTitles = useSessionStore((state) => state.programTitles);
  if (!tab) return '';
  if (!isSessionTab(tab)) return tab.title;
  let programTitle = '';
  for (const terminal of terminalsOf(tab)) {
    const value = programTitles[terminal.id];
    if (value && value.trim()) {
      programTitle = value;
      break;
    }
  }
  return resolveDisplayTitle(tab.title, tab.titleSource, programTitle);
}

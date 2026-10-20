import { searchHistory } from '@platform/api/search';
import { writeClipboardText } from '@platform/clipboard';
import { useSessionStore } from '@features/workspace';
import type { HistoryCommandEntry } from '@core/commandHistory';
import { commandEnvironment } from '@core/commandHistory';
import { isWithin } from '../model/commands';
import type { ExecutionContext } from './execution';
import { useSettingsNavigationStore } from '@features/settings/stores/navigation';

export const copyCommand = (command: string) => writeClipboardText(command);
export const openCommandSettings = () => { useSettingsNavigationStore.getState().setSelected('command-history'); useSessionStore.getState().openSettings(); };
export const openCommandModelSettings = () => { useSettingsNavigationStore.getState().setSelected('ai-model'); useSessionStore.getState().openSettings(); };
export async function importLegacyCommands(context: ExecutionContext): Promise<HistoryCommandEntry[]> {
  const rows = await searchHistory('', 1000);
  return rows.filter(row => isWithin(row.cwd, context.root)).map(row => ({ id: String(row.id), ...commandEnvironment(context.spec),
    command: row.command, cwd: row.cwd, status: 'unknown', exitCode: row.exit_code, timestamp: row.timestamp, runCount: row.run_count }));
}

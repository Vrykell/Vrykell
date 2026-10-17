import { invoke } from '@platform/diagnostics';
import type { HistoryCommandEntry, HistoryCommandContext, HistoryCommandPreferences, HistoryCommandMutation } from '@core/commandHistory';

export const recordHistoryCommand = (entry: HistoryCommandEntry) => invoke<void>('command_history_record', { entry });
export const listCommandHistory = (target: string, root: string) => invoke<HistoryCommandEntry[]>('command_history_list', { target, root });
const writes = new Map<string, Promise<void>>();
export function mutateHistoryCommand(change: HistoryCommandMutation): Promise<HistoryCommandPreferences> {
  const write = (writes.get(change.scope) ?? Promise.resolve()).catch(() => {}).then(() =>
    invoke<HistoryCommandPreferences>('command_history_mutate', { change }));
  const done = write.then(() => {});
  writes.set(change.scope, done);
  void done.finally(() => { if (writes.get(change.scope) === done) writes.delete(change.scope); }).catch(() => {});
  return write;
}
export async function getHistoryPreferences(scope: string): Promise<HistoryCommandPreferences | null> {
  await writes.get(scope)?.catch(() => {});
  const value = await invoke<HistoryCommandPreferences | null>('command_history_preferences', { scope });
  if (value && (!Array.isArray(value.favorites) || !Array.isArray(value.hidden) || !Array.isArray(value.rules)
    || !value.favorites.every(item => ['id', 'name', 'command', 'cwd', 'shell'].every(key => typeof item[key as keyof typeof item] === 'string'))
    || !value.hidden.every(item => typeof item === 'string')
    || !value.rules.every(item => item && typeof item.id === 'string' && typeof item.value === 'string' && ['name', 'prefix'].includes(item.kind))
    || value.runIn !== undefined && !['current', 'new'].includes(value.runIn)
    || value.groups !== undefined && (!Array.isArray(value.groups) || !value.groups.every(group => group && typeof group.id === 'string'
      && typeof group.name === 'string' && Array.isArray(group.commandKeys) && group.commandKeys.every(key => typeof key === 'string')))
    || value.historyOrder !== undefined && (!Array.isArray(value.historyOrder) || !value.historyOrder.every(key => typeof key === 'string'))
    || value.groupOrder !== undefined && (!Array.isArray(value.groupOrder) || !value.groupOrder.every(key => typeof key === 'string'))
    || value.groupColors !== undefined && (!value.groupColors || typeof value.groupColors !== 'object' || Array.isArray(value.groupColors)
      || !Object.values(value.groupColors).every(color => typeof color === 'string')))) throw new Error('Invalid command history preferences');
  return value;
}
export function saveHistoryPreferences(scope: string, payload: HistoryCommandPreferences): Promise<void> {
  const write = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => invoke<void>('command_history_save_preferences', { scope, payload }));
  writes.set(scope, write);
  void write.finally(() => { if (writes.get(scope) === write) writes.delete(scope); }).catch(() => {});
  return write;
}
export const getCommandContext = (cwd: string, root: string | null, connectionId?: string, includeFiles = false) =>
  invoke<HistoryCommandContext>('command_history_context', { cwd, root, connectionId: connectionId ?? null, includeFiles });
export const getProjectRootOverride = (target: string) => invoke<{ roots?: string[] } | null>('command_history_preferences', { scope: `roots:${target}` });
export async function saveProjectRootOverride(target: string, root: string): Promise<void> {
  const previous = await getProjectRootOverride(target);
  return invoke<void>('command_history_save_preferences', { scope: `roots:${target}`, payload: { roots: [...new Set([...(previous?.roots ?? []), root])] } });
}

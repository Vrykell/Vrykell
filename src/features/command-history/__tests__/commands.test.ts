import { describe, expect, it } from 'vitest';
import { commandEnvironment, type HistoryCommandEntry } from '@core/commandHistory';
import { commandKey, emptyPreferences, isWithin, projectItems, restoreRunningStatus } from '../model/commands';

const entry = (id: string, command: string, cwd = '/work/app', shell = 'bash'): HistoryCommandEntry =>
  ({ id, target: 'local', shell, command, cwd, status: 'success', exitCode: 0, timestamp: 1, runCount: 3 });

describe('project commands', () => {
  it('sorts history by recency or frequency without mutating source data or favorite order', () => {
    const history = [
      { ...entry('older', 'git status'), timestamp: 10, runCount: 2 },
      { ...entry('frequent', 'npm run dev'), timestamp: 20, runCount: 20 },
      { ...entry('latest', 'cargo test'), timestamp: 30, runCount: 2 },
      { ...entry('manual', 'npm run preview'), timestamp: 40, runCount: 0 },
    ];
    const preferences = emptyPreferences();
    expect(projectItems(history, preferences, '', 'all').history.map(item => item.id)).toEqual(['manual', 'latest', 'frequent', 'older']);
    expect(projectItems(history, preferences, '', 'all', undefined, 'frequent').history.map(item => item.id)).toEqual(['frequent', 'latest', 'older', 'manual']);
    expect(history.map(item => item.id)).toEqual(['older', 'frequent', 'latest', 'manual']);
    preferences.favorites = [{ ...history[0]!, name: 'First' }, { ...history[1]!, name: 'Second' }];
    expect(projectItems(history, preferences, '', 'all', undefined, 'frequent').favorites.map(item => item.name)).toEqual(['First', 'Second']);
  });
  it('does not show an unconfirmed command as running after a restart', () => {
    const running = { ...entry('active', 'npm run dev'), status: 'running' as const };
    expect(restoreRunningStatus([running], new Set())[0]?.status).toBe('unknown');
    expect(restoreRunningStatus([running], new Set(['active']))[0]?.status).toBe('running');
  });
  it('supports saved manual order and combines collection and status filters', () => {
    const history = [entry('one', 'npm run build'), { ...entry('two', 'cargo test'), status: 'failed' as const }, entry('three', 'git status')];
    const preferences = { ...emptyPreferences(), historyOrder: [commandKey(history[2]!), commandKey(history[0]!)],
      groups: [{ id: 'checks', name: 'Checks', commandKeys: [commandKey(history[1]!)] }] };
    expect(projectItems(history, preferences, '', 'all', undefined, 'manual').history.map(item => item.id)).toEqual(['three', 'one', 'two']);
    expect(projectItems(history, preferences, '', 'failed', undefined, 'recent', true).history.map(item => item.id)).toEqual(['two']);
    expect(projectItems(history, preferences, '', 'success', undefined, 'recent', true).history).toEqual([]);
  });
  it('separates local and SSH identities, users, ports and shells', () => {
    expect(commandEnvironment({ kind: 'local' })).toEqual({ target: 'local', shell: 'system' });
    expect(commandEnvironment({ kind: 'ssh', ssh: { host: 'HOST', user: 'one' } }).target)
      .toBe(commandEnvironment({ kind: 'ssh', ssh: { host: 'host', user: 'one', port: 22 } }).target);
    expect(commandEnvironment({ kind: 'ssh', ssh: { host: 'host', user: 'one' } }).target)
      .not.toBe(commandEnvironment({ kind: 'ssh', ssh: { host: 'host', user: 'two' } }).target);
    expect(commandEnvironment({ kind: 'ssh', ssh: { host: 'host', port: 23 } }).target)
      .not.toBe(commandEnvironment({ kind: 'ssh', ssh: { host: 'host' } }).target);
  });
  it('matches directory boundaries and preserves remote case', () => {
    expect(isWithin('/work/app/sub', '/work/app')).toBe(true);
    expect(isWithin('/work/application', '/work/app')).toBe(false);
    expect(isWithin('/work/App', '/work/app')).toBe(false);
    expect(isWithin('C:\\WORK\\app\\src', 'c:/work/app/')).toBe(true);
    expect(isWithin('C:/work', 'c:/')).toBe(true);
    expect(isWithin('/home/a', '/')).toBe(true);
    expect(isWithin('/work/app/../../other', '/work/app')).toBe(false);
    expect(isWithin('', '/')).toBe(false);
    expect(isWithin('relative/path', 'relative')).toBe(false);
  });
  it('keeps favorites visible while rules and permanent hides filter history', () => {
    const history = [entry('1', 'ls'), entry('2', 'ls -l'), entry('3', 'npm run build'), entry('4', 'lsof')];
    const preferences = emptyPreferences();
    preferences.rules.push({ id: 'name', kind: 'name', value: 'ls' });
    preferences.hidden.push(commandKey(history[2]!));
    preferences.favorites.push({ ...history[0]!, name: 'List files' });
    const result = projectItems(history, preferences, '', 'all');
    expect(result.favorites.map(item => item.name)).toEqual(['List files']);
    expect(result.history.map(item => item.command)).toEqual(['lsof']);
    preferences.rules = [{ id: 'prefix', kind: 'prefix', value: 'npm run' }];
    preferences.hidden = [];
    expect(projectItems(history, preferences, '', 'all').history.map(item => item.command)).toEqual(['ls -l', 'lsof']);
  });
  it('searches saved names, commands and paths and filters status and cwd', () => {
    const history = [entry('1', 'npm run build'), { ...entry('2', 'cargo test', '/work/app/src-tauri'), status: 'failed' as const }];
    const preferences = emptyPreferences();
    preferences.favorites = [{ ...history[0]!, name: 'Production build' }];
    preferences.groups = [{ id: 'release', name: 'Release', commandKeys: [commandKey(history[0]!)] }];
    expect(projectItems(history, preferences, 'Release', 'all').favorites).toHaveLength(1);
    expect(projectItems(history, preferences, 'Release', 'failed').favorites).toHaveLength(0);
    expect(projectItems(history, preferences, 'production', 'all').favorites).toHaveLength(1);
    expect(projectItems(history, preferences, 'src-tauri', 'failed').history).toHaveLength(1);
    expect(projectItems(history, preferences, '', 'all', '/work/app').history).toHaveLength(0);
    expect(commandKey(history[0]!)).not.toBe(commandKey({ ...history[0]!, shell: 'pwsh' }));
  });
});

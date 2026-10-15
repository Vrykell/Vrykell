import { iconColorKey, iconColorCss, type IconColors } from '@config/iconColors';
import type { Tab } from './session/store';

export function tabIconKey(tab: Pick<Tab, 'id' | 'kind'>): string {
  return iconColorKey(tab.kind === 'session' ? 'session' : 'page', tab.kind === 'session' ? tab.id : tab.kind);
}

export function tabIconColor(tab: Pick<Tab, 'id' | 'kind'> & { groupId?: string }, colors: IconColors): string | undefined {
  return iconColorCss(colors[tabIconKey(tab)] ?? (tab.kind === 'session' && tab.groupId ? colors[iconColorKey('group', tab.groupId)] : undefined));
}

export function pageIconColor(kind: Tab['kind']): string {
  return kind === 'history' ? 'var(--group-amber)' : kind === 'ai-history' ? 'var(--group-violet)' : 'var(--group-blue)';
}

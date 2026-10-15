import { iconColorKey, iconColorCss, type IconColors } from '@config/iconColors';
import type { Tab } from './session/store';
import { leaves, type WindowLayout, type TerminalSpec } from './windowLayout';

export function tabIconKey(tab: Pick<Tab, 'id' | 'kind'>): string {
  return iconColorKey('session', tab.id);
}

export function tabIconColor(tab: Pick<Tab, 'id' | 'kind'> & { layout?: WindowLayout; groupId?: string }, colors: IconColors, pane?: TerminalSpec): string | undefined {
  if (tab.kind !== 'session') return undefined;
  const explicit = colors[tabIconKey(tab)];
  if (explicit) return iconColorCss(explicit);
  const terminal = pane ?? (tab.layout ? leaves(tab.layout)[0] : undefined);
  const connectionId = terminal?.kind === 'ssh' ? terminal.ssh?.connectionId : undefined;
  return connectionId ? iconColorCss(colors[iconColorKey('ssh', connectionId)]) : undefined;
}

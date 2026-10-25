import { useMemo } from 'react';
import { useSessionStore } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import { t } from '@i18n';
import type { ChatEnvironment } from '../model/conversation';
import { environmentForPane } from '../services/conversationContext';

export function useExecutionTerminalOptions(environment?: ChatEnvironment | null) {
  const tabs = useSessionStore(state => state.tabs);
  const terminalCwds = useSessionStore(state => state.terminalCwds);
  const sessions = useTerminalStore(state => state.sessions);
  const startupStates = useTerminalStore(state => state.startupStates);
  return useMemo(() => {
    const available = tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout).map((pane, index, panes) => ({ pane, tab, index, count: panes.length })) : [])
      .filter(({ pane }) => !!sessions[pane.id]).map(({ pane, tab, index, count }) => {
        const context = environmentForPane(pane.id)!;
        const triggerLabel = pane.kind === 'ssh' ? pane.ssh?.host || pane.ssh?.name || context.label : t('Local terminal');
        const host = pane.kind === 'ssh' ? pane.ssh?.host : undefined;
        const hostLabel = host && !context.label.includes(host) ? ` · ${host}` : '';
        const name = `${tab.title}${count > 1 ? ` · ${t('Pane {{number}}', { number: index + 1 })}` : ''}`;
        const swatch = startupStates[pane.id] === 'starting' ? 'var(--accent-warm)'
          : startupStates[pane.id] === 'failed' || startupStates[pane.id] === 'closed' ? 'var(--error)' : 'var(--text-secondary)';
        return { value: pane.id, label: name, triggerLabel, description: `${context.label}${hostLabel}${context.cwd ? ` · ${context.cwd}` : ''}`, swatch, disabled: false };
      });
    return [
      { value: '', label: t('Discussion only'), triggerLabel: t('Discussion'), swatch: 'var(--text-muted)', description: undefined, disabled: false },
      ...(environment && !available.some(option => option.value === environment.paneId)
        ? [{ value: environment.paneId, label: `${environment.label} · ${t('Disconnected')}`, triggerLabel: `${environment.label} · ${t('Disconnected')}`, description: undefined, swatch: 'var(--accent-warm)', disabled: true }] : []),
      ...available,
    ];
  }, [tabs, sessions, startupStates, terminalCwds, environment]);
}

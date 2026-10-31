import { useCallback, useEffect, useMemo } from 'react';
import { shellTypeLabel } from '@platform/shells';
import { useTerminalStore } from '@features/terminal';
import { t } from '@i18n';
import { isSessionTab, terminalsOf, useSessionStore } from '../model/session/store';
import type { TerminalSpec } from '../model/windowLayout';
import { usePanelTerminalStore, type PanelTerminalBinding, type PanelTerminalPanel } from '../stores/panelTerminal';
import { useActiveWorkspace } from './useActiveWorkspace';

export interface PanelTerminalOption {
  paneId: string;
  tabId: string;
  label: string;
  description?: string;
  live: boolean;
  focused: boolean;
  spec: TerminalSpec;
}

export interface PanelTerminalState {
  /** Raw binding, retained until the pane disappears or the user follows focus again. */
  binding: PanelTerminalBinding | null;
  /** The bound pane only while it is live and matches its identity snapshot. */
  boundPaneId: string | null;
  isBound: boolean;
  paneId: string | null;
  spec: TerminalSpec | null;
  cwd?: string;
  connectionId?: string;
  options: PanelTerminalOption[];
  bind: (paneId: string | null) => void;
  clear: () => void;
}

/**
 * Resolves one panel's effective terminal. A live binding wins over focus; a closed or
 * replaced pane drops the binding and the panel follows the focused terminal again.
 */
export function usePanelTerminal(panel: PanelTerminalPanel): PanelTerminalState {
  const tabs = useSessionStore(state => state.tabs);
  const terminalCwds = useSessionStore(state => state.terminalCwds);
  const sessions = useTerminalStore(state => state.sessions);
  const shellTypes = useTerminalStore(state => state.shellTypes);
  const active = useActiveWorkspace();
  const binding = usePanelTerminalStore(state => state.bindings[panel] ?? null);
  const bindTo = usePanelTerminalStore(state => state.bind);
  const clearBinding = usePanelTerminalStore(state => state.clear);

  const options = useMemo(() => tabs.filter(isSessionTab).flatMap(tab => {
    const specs = terminalsOf(tab);
    return specs.map((spec, index): PanelTerminalOption | null => {
      if (!sessions[spec.id]) return null;
      const shellType = shellTypes?.[spec.id] ?? spec.shellType;
      const cwd = terminalCwds[spec.id] ?? spec.cwd;
      const detail = spec.kind === 'ssh' ? spec.ssh?.host : shellType ? shellTypeLabel(shellType) : '';
      return {
        paneId: spec.id,
        tabId: tab.id,
        label: specs.length > 1 ? `${tab.title} · ${t('Pane {{number}}', { number: index + 1 })}` : tab.title,
        description: [detail, cwd].filter(Boolean).join(' · '),
        live: true,
        focused: tab.id === active.activeTab?.id && spec.id === active.focusedPaneId,
        spec,
      };
    }).filter((option): option is PanelTerminalOption => option !== null);
  }), [active.activeTab?.id, active.focusedPaneId, sessions, shellTypes, tabs, terminalCwds]);

  const bound = useMemo(() => {
    if (!binding) return null;
    return options.find(option => option.paneId === binding.paneId
      && option.spec.kind === binding.kind
      && (option.spec.ssh?.connectionId ?? undefined) === binding.connectionId) ?? null;
  }, [binding, options]);

  useEffect(() => {
    if (binding && !bound) clearBinding(panel);
  }, [binding, bound, clearBinding, panel]);

  const effectiveSpec = bound?.spec ?? active.focusedSpec;
  const effectivePaneId = bound?.paneId ?? active.focusedPaneId;
  const cwd = bound ? terminalCwds[bound.paneId] ?? bound.spec.cwd : active.activeCwd;
  const connectionId = effectiveSpec?.kind === 'ssh' ? effectiveSpec.ssh?.connectionId : undefined;
  const clear = useCallback(() => clearBinding(panel), [clearBinding, panel]);
  const bind = useCallback((paneId: string | null) => {
    if (!paneId) { clear(); return; }
    const option = options.find(item => item.paneId === paneId);
    if (!option) return;
    bindTo(panel, {
      paneId: option.paneId,
      tabId: option.tabId,
      kind: option.spec.kind,
      connectionId: option.spec.ssh?.connectionId,
    });
  }, [bindTo, clear, options, panel]);

  return {
    binding,
    boundPaneId: bound?.paneId ?? null,
    isBound: !!bound,
    paneId: effectivePaneId,
    spec: effectiveSpec,
    cwd,
    connectionId,
    options,
    bind,
    clear,
  };
}

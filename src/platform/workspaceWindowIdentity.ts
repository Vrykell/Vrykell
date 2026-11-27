import { create } from 'zustand';

/** A detached surface can render its contents before it owns their runtime resources. */
export const useWorkspaceWindowStaging = create<{ staged: boolean; agents: ReadonlySet<string> }>(() => ({
  staged: false,
  agents: new Set(),
}));

export function isWorkspaceWindowLabel(label: string) {
  return label === 'main' || /^app-[a-z0-9-]{1,64}$/.test(label);
}

/** Storage scope is needed before the rest of the desktop bridges are initialized. */
export function secondaryWorkspaceLabel() {
  const desktop = window as Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } };
  const label = desktop.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  return label?.startsWith('app-') && isWorkspaceWindowLabel(label) ? label : null;
}

export function workspaceSessionPrefix(label: string) {
  return `window:${label}:`;
}

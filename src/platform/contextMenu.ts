import { invoke } from './diagnostics';

export interface ContextMenuStatus {
  supported: boolean;
  available: boolean;
  enabled: boolean;
  /** A registration that still points at an older package or executable: enabling updates it. */
  stale: boolean;
  certificateTrusted: boolean;
  certificateThumbprint: string | null;
}
export type ContextMenuAction = 'enable' | 'disable' | 'trust' | 'untrust';
export const getContextMenuStatus = () => invoke<ContextMenuStatus>('context_menu_status');
export const manageContextMenu = (action: ContextMenuAction) => invoke<ContextMenuStatus>('context_menu_manage', { action });
export const getShellLaunchDirectory = () => invoke<string | null>('shell_launch_directory');

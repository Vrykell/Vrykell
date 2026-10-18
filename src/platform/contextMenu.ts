import { invoke } from './diagnostics';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
/** Directories a launch forwarded to this already-running window; drains the queue. */
export const takeForwardedLaunchDirectories = () => invoke<string[]>('shell_take_forwarded_directories');
/** Fires when another launch was redirected here, so the caller can drain the queue. */
export const onForwardedLaunch = (handler: () => void): Promise<UnlistenFn> =>
  listen('shell-launch-forwarded', () => handler());

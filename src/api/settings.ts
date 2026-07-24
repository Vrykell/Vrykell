/**
 * Settings / lifecycle commands (Renderer → Backend)
 */
import { invoke } from '@tauri-apps/api/core';

export function loadSettings(): Promise<unknown> {
  return invoke('load_settings');
}

export function saveSettings(settings: unknown): Promise<void> {
  return invoke('save_settings', { settings });
}

export function exitApp(): Promise<void> {
  return invoke('exit_app');
}

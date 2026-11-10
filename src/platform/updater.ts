import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import manifest from '../../package.json';
import { ptyCloseAll } from './pty';
import { flushDiagnostics } from './diagnostics';

export type AppUpdate = Pick<NonNullable<Awaited<ReturnType<typeof check>>>, 'version' | 'body' | 'download' | 'install' | 'close'>;
export const supportsAppUpdates = () => import.meta.env.VITE_DISABLE_UPDATES !== 'true' && isTauri();
export const applicationVersion = () => isTauri() ? getVersion() : Promise.resolve(manifest.version);
export const checkApplicationUpdate = () => supportsAppUpdates() ? check({ timeout: 15000 }) : Promise.resolve(null);
export const restartApplication = () => relaunch();
export async function prepareApplicationUpdate() { await ptyCloseAll(); await flushDiagnostics(); }
export const openProjectPage = (page: 'project' | 'releases' | 'license') => openUrl(`https://github.com/Vrykell/Vrykell${page === 'releases' ? '/releases/latest' : page === 'license' ? '/blob/main/LICENSE' : ''}`);

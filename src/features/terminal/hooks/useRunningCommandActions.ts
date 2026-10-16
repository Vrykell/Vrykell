import { useMemo } from 'react';
import { t } from '@i18n';
import { isMacOS } from '@platform/runtime';
import type { ContextMenuItem } from '@ui/ContextMenu';
import { redrawTerminal } from '../services/terminalRepaint';
import { useTuiControls } from './useTuiControls';

/**
 * Quick actions for a running command, matching the status-bar toolbar so the
 * hover-revealed controls stay reachable from the context menu. `mode` picks the
 * fullscreen toggle that fits the surface the menu was opened from.
 */
export function useRunningCommandActions(paneId: string, mode: 'block' | 'fullscreen'): ContextMenuItem[] {
  const { killArmed, sendCtrlC, killApp, enterFullScreen, exitFullScreen } = useTuiControls(paneId);
  return useMemo(() => [
    { label: t('Redraw terminal'), shortcut: isMacOS ? 'Meta+Shift+R' : 'Control+Shift+R', onClick: () => redrawTerminal(paneId) },
    { label: t('Interrupt command'), shortcut: 'Control+C', onClick: sendCtrlC },
    { label: t(killArmed ? 'Force quit foreground process' : 'Quit foreground process'), onClick: killApp },
    mode === 'fullscreen'
      ? { label: t('Exit fullscreen'), onClick: exitFullScreen }
      : { label: t('Enter fullscreen interaction'), onClick: enterFullScreen },
  ], [paneId, killArmed, sendCtrlC, killApp, enterFullScreen, exitFullScreen, mode]);
}

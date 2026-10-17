import { useMemo } from 'react';
import { t } from '@i18n';
import { isMacOS } from '@platform/runtime';
import type { ContextMenuItem } from '@ui/ContextMenu';
import { redrawTerminal } from '../services/terminalRepaint';
import { useTuiControls } from './useTuiControls';

/**
 * Surface the menu was opened from: a running block card, the manual fullscreen host,
 * or a real alternate-screen TUI rendered by the main terminal.
 */
export type RunningCommandSurface = 'block' | 'fullscreen' | 'altScreen';

/**
 * Quick actions for a running command, matching the status-bar toolbar so the
 * hover-revealed controls stay reachable from the context menu. The surface also picks
 * the fullscreen toggle: enter for a block card, exit for the manual host and none for a
 * real alternate screen, whose banner exposes no toggle either.
 */
export function useRunningCommandActions(paneId: string, surface: RunningCommandSurface): ContextMenuItem[] {
  const { killArmed, sendCtrlC, killApp, enterFullScreen, exitFullScreen } = useTuiControls(paneId);
  return useMemo(() => {
    const items: ContextMenuItem[] = [
      { label: t('Redraw terminal'), shortcut: isMacOS ? 'Meta+Shift+R' : 'Control+Shift+R', onClick: () => redrawTerminal(paneId) },
      { label: t('Interrupt command'), shortcut: 'Control+C', onClick: sendCtrlC },
      { label: t(killArmed ? 'Force quit foreground process' : 'Quit foreground process'), onClick: killApp },
    ];
    if (surface === 'fullscreen') items.push({ label: t('Exit fullscreen'), onClick: exitFullScreen });
    if (surface === 'block') items.push({ label: t('Enter fullscreen interaction'), onClick: enterFullScreen });
    return items;
  }, [paneId, killArmed, sendCtrlC, killApp, enterFullScreen, exitFullScreen, surface]);
}

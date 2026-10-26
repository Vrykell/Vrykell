import { t } from '@i18n';
import { History, iconSizes } from '@ui/icons';
import { TerminalProfileIcon } from '@ui/icons/shellIcons';
import IconCountBadge from '@ui/feedback/IconCountBadge';
import { tabCapabilities, type TabHandle } from '@ui/layout/tabHandle';
import type { ShellType } from '@platform/shells';
import { firstTerminalOf, isSessionTab, terminalsOf, type Tab } from '../stores/workspace';

/**
 * Project a terminal-area page into a strip row.
 *
 * Session pages can join a named session group; history and start pages share the strip but
 * stay on the canvas surface and are not draggable into groups.
 */
export function terminalTabHandle(tab: Tab, title: string, defaultShellType?: ShellType, closeTestId?: string): TabHandle {
  const first = firstTerminalOf(tab);
  const terminals = terminalsOf(tab);
  return {
    id: tab.id,
    label: title,
    tip: title,
    icon: tab.kind === 'history'
      ? <History size={iconSizes.compact} />
      : <IconCountBadge count={terminals.length}>
          <TerminalProfileIcon colored kind={first?.kind} shellType={first?.shellType ?? (isSessionTab(tab) ? defaultShellType : undefined)} connectionId={first?.ssh?.connectionId} size={iconSizes.control} />
        </IconCountBadge>,
    closeLabel: t('Close this tab'),
    ...(closeTestId ? { closeTestId } : {}),
    capabilities: tabCapabilities({ renameable: isSessionTab(tab), groupable: isSessionTab(tab) }),
  };
}

import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { TerminalPrompt } from '@ui/icons';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { dropdownAnchorBelow, type DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { useSessionStore } from '@features/workspace';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import { useWorkspaceNavigation } from '../stores/navigation';
import { useUiStore } from '../stores/ui';
import NewTabModal from './NewTabModal';
import WorkspaceStartPage from './WorkspaceStartPage';

export default function TerminalLauncher() {
  const [picker, setPicker] = useState<DropdownAnchor | null>(null);
  const hasHosts = useSshStore((state) => state.connections.length > 0);
  const terminalActive = useWorkspaceNavigation((state) => state.area === 'terminal');
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const pickerAvailable = terminalActive && !settingsOpen;
  useEffect(() => {
    ensureSshLoaded();
  }, []);
  useEffect(() => {
    if (!pickerAvailable) setPicker(null);
  }, [pickerAvailable]);
  return (
    <div className="workspace-launch-page" data-testid="start-page">
      <WorkspaceStartPage
        icon={<TerminalPrompt size={40} />}
        title={t('Start a terminal')}
        description={t(hasHosts ? 'Open a shell profile or connect to a saved host.' : 'Open a shell profile to start a session.')}
        actions={
          <>
            <OutlineButton className="primary-button" data-testid="terminal-start-new" onClick={() => useSessionStore.getState().addTab()}>
              {t('New terminal')}
            </OutlineButton>
            <OutlineButton
              data-testid="terminal-start-picker"
              aria-haspopup="dialog"
              onClick={(event) => setPicker(dropdownAnchorBelow(event.currentTarget))}>
              {t('Choose a profile…')}
            </OutlineButton>
            {hasHosts && <OutlineButton onClick={() => selectWorkspaceArea('ssh')}>{t('Connect a server')}</OutlineButton>}
          </>
        }
      />
      <NewTabModal open={!!picker && pickerAvailable} anchor={picker ?? undefined} onClose={() => setPicker(null)} />
    </div>
  );
}

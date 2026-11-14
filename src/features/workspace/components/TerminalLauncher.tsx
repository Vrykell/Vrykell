import { useEffect, useState } from 'react';
import { t } from '@i18n';
import { TerminalPrompt } from '@ui/icons';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { useSessionStore } from '@features/workspace';
import { ensureSshLoaded, useSshStore } from '@features/ssh';
import { selectWorkspaceArea } from '../services/selectWorkspaceArea';
import NewTabModal from './NewTabModal';
import WorkspaceStartPage from './WorkspaceStartPage';

/**
 * The terminal start page keeps the same resting shape as every other workspace: a title,
 * one line of orientation and the primary actions. Profile and host lists live in the
 * existing picker, which already carries search, defaults, locations and per-row settings.
 */
export default function TerminalLauncher() {
  const [pickerOpen, setPickerOpen] = useState<{ x: number; y: number } | null>(null);
  const hosts = useSshStore(state => state.connections);
  useEffect(() => { ensureSshLoaded(); }, []);
  // The picker opens under its own trigger, aligned to the button's start edge, so it reads as
  // belonging to the action instead of appearing wherever the pointer happened to be.
  const openPicker = (event: React.MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPickerOpen({ x: box.left, y: box.bottom });
  };
  return <div className="workspace-launch-page" data-testid="start-page">
    <WorkspaceStartPage icon={<TerminalPrompt size={40} />} title={t('Start a terminal')}
      description={t(hosts.length ? 'Open a shell profile or connect to a saved host.' : 'Open a shell profile to start a session.')}
      actions={<>
        <OutlineButton className="primary-button" data-testid="terminal-start-new" onClick={() => useSessionStore.getState().addTab()}>{t('New terminal')}</OutlineButton>
        <OutlineButton data-testid="terminal-start-picker" onClick={openPicker}>{t('Choose a profile…')}</OutlineButton>
        {!!hosts.length && <OutlineButton onClick={() => selectWorkspaceArea('ssh')}>{t('Connect a server')}</OutlineButton>}
      </>} />
    <NewTabModal open={!!pickerOpen} anchor={pickerOpen ?? undefined} onClose={() => setPickerOpen(null)} />
  </div>;
}

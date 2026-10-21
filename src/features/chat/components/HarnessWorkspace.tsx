import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import FolderTabs from '@ui/FolderTabs';
import { IconButton } from '@ui/IconButton';
import ConfirmDialog from '@ui/ConfirmDialog';
import { Plus, DataUsage, Folder } from '@ui/icons';
import { registerHarnessCloseGuard, interceptHarnessClose } from '@core/harness';
import { pickPath } from '@platform/api/fs';
import { useToastStore } from '@ui/Toast';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore, useUiStore } from '@features/workspace';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useHarnessStore } from '../stores/harness';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useComposerDrafts } from '../stores/composerDrafts';
import HarnessView from './HarnessView';

/** One workspace page hosts independent sessions through the shared connected tabs. */
export default function HarnessWorkspace({ active }: { active: boolean }) {
  const { connections, selected, select, move } = useHarnessWorkspace();
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const visible = active && !settingsOpen;
  const [picker, setPicker] = useState(false);
  const [directory, setDirectory] = useState<string | undefined>(undefined);
  const [closing, setClosing] = useState<(() => void) | null>(null);
  useEffect(() => registerHarnessCloseGuard((ids, complete) => {
    const sessions = useHarnessStore.getState().byTab;
    const drafts = useComposerDrafts.getState().byTab;
    if (!ids.some(id => sessions[id]?.pending || sessions[id]?.opening || sessions[id]?.permission || drafts[id]?.text.trim())) return false;
    setClosing(() => complete);
    return true;
  }), []);
  const chooseDirectory = async () => {
    try {
      const [path] = await pickPath('directory');
      if (path) { setDirectory(path); setPicker(true); }
    } catch { useToastStore.getState().addToast(t('Could not choose a project folder.'), 'error'); }
  };
  const close = (id: string) => {
    const complete = () => useHarnessWorkspace.getState().close([id]);
    if (!interceptHarnessClose([id], complete)) complete();
  };
  const pick = (name: string) => {
    useSessionStore.getState().openHarnessTab(name, directory);
    setPicker(false);
    setDirectory(undefined);
  };
  return <div data-testid="harness-workspace" style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
    <FolderTabs label={t('ACP sessions')} selected={selected} listId="harness-sessions"
      items={connections.map(item => { const Mark = harnessMark(item.harness); return {
        id: item.id, label: item.harness, tip: item.cwd ? `${item.harness} · ${item.cwd}` : item.harness,
        icon: <Mark size={16} />, closeLabel: t('Close session {{name}}', { name: item.harness }),
      }; })} onSelect={select} onMove={move} onClose={close} toolbar={<>
        <IconButton compact data-testid="harness-add-session" aria-label={t('Connect a server')} data-tip={t('Connect a server')} onClick={() => setPicker(true)}><Plus size={16} /></IconButton>
        <IconButton compact aria-label={t('Choose project folder')} data-tip={t('Choose project folder')} onClick={() => void chooseDirectory()}><Folder size={16} /></IconButton>
        <IconButton compact aria-label={t('Usage statistics')} data-tip={t('Usage statistics')} onClick={() => useSessionStore.getState().openUsageTab()}><DataUsage size={16} /></IconButton>
      </>} />
    {connections.length === 0 && <AcpLauncher open={visible} embedded onClose={() => {}} onPick={pick} />}
    {connections.map(item => <div key={item.id} inert={!visible || item.id !== selected}
      style={{ display: item.id === selected ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
      <HarnessView tabId={item.id} harness={item.harness} cwd={item.cwd} fresh={item.fresh} active={visible && item.id === selected} />
    </div>)}
    {connections.length > 0 && <AcpLauncher open={picker && visible} onClose={() => { setPicker(false); setDirectory(undefined); }} onPick={pick} />}
    {closing && createPortal(<ConfirmDialog open title={t('Close ACP sessions?')}
      message={t('Closing stops active work and discards unsent drafts.')} confirmLabel={t('Close sessions')} cancelLabel={t('Cancel')} danger
      onCancel={() => setClosing(null)} onConfirm={() => { const complete = closing; setClosing(null); complete(); }} />, document.body)}
  </div>;
}

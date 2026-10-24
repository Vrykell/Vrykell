import { useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@i18n';
import ToolDialog from '@ui/feedback/ToolDialog';
import { TextInput } from '@ui/fields/TextInput';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import ErrorBox from '@ui/feedback/ErrorBox';

/** Change the current project's root in a focused directory editor. */
export default function ProjectRootMenu({ initial, local, onSave, onClose }: {
  initial: string; local: boolean; onSave: (root: string) => Promise<void>; onClose: () => void;
}) {
  const [root, setRoot] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const save = async () => {
    if (saving.current || !root.trim()) return;
    saving.current = true; setBusy(true); setError('');
    try { await onSave(root.trim()); onClose(); }
    catch (reason) { setError(String(reason)); }
    finally { saving.current = false; setBusy(false); }
  };
  return <ToolDialog label={t('Set project root')} onClose={onClose} busy={busy} initialFocus="input">
    <form className="command-history-tool" onSubmit={event => { event.preventDefault(); void save(); }}>
      <TextInput variant="field" aria-label={t('Project root')} value={root} disabled={busy} onChange={event => setRoot(event.target.value)} />
      <div className="command-history-actions">
        {local && <TextButton disabled={busy} onClick={() => {
          void open({ directory: true, multiple: false, defaultPath: root, title: t('Set project root') })
            .then(path => { if (typeof path === 'string') setRoot(path); }).catch(reason => setError(String(reason)));
        }}>{t('Browse…')}</TextButton>}
        <TextButton disabled={busy} onClick={onClose}>{t('Cancel')}</TextButton>
        <OutlineButton type="submit" disabled={busy || !root.trim()}>{t(busy ? 'Saving…' : 'Save')}</OutlineButton>
      </div>
      {error && <ErrorBox title={t('Could not set the project root')} details={error} />}
    </form>
  </ToolDialog>;
}

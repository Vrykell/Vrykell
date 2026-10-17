import { useRef, useState } from 'react';
import { t } from '@i18n';
import type { HistoryCommandDraft } from '@core/commandHistory';
import { TextInput } from '@ui/TextInput';
import ConfigTextArea from '@ui/ConfigTextArea';
import { OutlineButton } from '@ui/OutlineButton';
import ErrorBox from '@ui/ErrorBox';
import ToolDialog from '@ui/ToolDialog';
import { isWithin } from '../model/commands';

/** Edit reusable command text and its directory without submitting terminal input. */
export default function CommandEditor({ initial, root, creating, onSave, onClose }: {
  initial: HistoryCommandDraft; root: string; creating: boolean;
  onSave: (draft: HistoryCommandDraft) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return;
    if (!draft.command.trim()) { setError(t('Enter a command.')); return; }
    if (!isWithin(draft.cwd, root)) { setError(t('The execution directory must be inside this project.')); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      await onSave({ ...draft, name: draft.name.trim(), command: draft.command.trim(), cwd: draft.cwd.trim() });
      onClose();
    } catch (reason) { setError(t(String(reason).replace(/^Error: /, ''))); }
    finally { saving.current = false; setBusy(false); }
  };
  const title = t(creating ? 'New command' : 'Edit command');
  return <ToolDialog label={title} onClose={onClose} onSubmit={() => { void save(); }} busy={busy} initialFocus="[data-command-editor-text]">
    <div className="command-history-editor">
      <label>{t('Command name (optional)')}<TextInput variant="field" value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <ConfigTextArea label={t('Command')} data-command-editor-text rows={5} value={draft.command} disabled={busy} onChange={event => setDraft({ ...draft, command: event.target.value })} />
      <label>{t('Execution directory')}<TextInput variant="field" value={draft.cwd} disabled={busy} onChange={event => setDraft({ ...draft, cwd: event.target.value })} /></label>
      <p className="command-history-editor-note">{t('Saving a command does not execute it.')}</p>
      {error && <ErrorBox title={t('Could not save the command')} details={error} />}
      <div className="command-history-actions">
        <OutlineButton disabled={busy} onClick={onClose}>{t('Cancel')}</OutlineButton>
        <OutlineButton disabled={busy || !draft.command.trim()} onClick={() => { void save(); }}>{t(busy ? 'Saving…' : 'Save')}</OutlineButton>
      </div>
    </div>
  </ToolDialog>;
}

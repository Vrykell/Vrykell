import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { TextInput } from '@ui/fields/TextInput';
import ConfigTextArea from '@ui/fields/ConfigTextArea';
import ToolWindow from '@ui/feedback/ToolWindow';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextButton } from '@ui/actions/TextButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import SafeMarkdown from '@features/chat/components/SafeMarkdown';
import { composeHistoryCommand, type CommandDraft, type DraftMessage } from '../services/aiCommands';
import type { ExecutionContext } from '../services/execution';
import type { CommandItem } from '../model/commands';
import { isWithin } from '../model/commands';

export default function CommandComposer({ context, recent, onFill, onFavorite, onSettings, onClose }: {
  context: ExecutionContext; recent: string[]; onFill: (item: CommandItem) => Promise<void>;
  onFavorite: (item: CommandItem) => Promise<void>; onSettings: () => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<CommandDraft | null>(null);
  const [messages, setMessages] = useState<DraftMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (filled && !saving) onClose(); }, [filled, saving, onClose]);
  const generate = async () => {
    if (!prompt.trim() || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError('');
    const next: DraftMessage[] = [...messages, ...(draft ? [{ role: 'assistant' as const, content: JSON.stringify(draft) }] : []), { role: 'user', content: prompt }];
    try {
      const result = await composeHistoryCommand(context, next, recent, controller.signal);
      if (!controller.signal.aborted) { setDraft(result); setMessages(next); setPrompt(''); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (request.current === controller) { setBusy(false); request.current = null; } }
  };
  const item: CommandItem | null = draft ? { id: crypto.randomUUID(), name: draft.command, command: draft.command, cwd: draft.cwd,
    shell: context.spec.kind === 'ssh' ? 'posix' : context.spec.shellType ?? 'system' } : null;
  const valid = !!item?.command.trim() && isWithin(item.cwd, context.root);
  const save = async (fill: boolean) => {
    if (!item || !valid || saving) return;
    setSaving(true); setError('');
    try { await (fill ? onFill(item) : onFavorite(item)); if (fill) setFilled(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <ToolWindow label={t('Write with AI')} onClose={onClose} onBeforeClose={() => request.current?.abort()} busy={saving} initialFocus="[data-command-composer-prompt]" footer={
    <div className="command-history-actions">
      <OutlineButton className="primary-button" disabled={busy || saving || !prompt.trim()} onClick={() => void generate()}>{t(draft ? 'Revise command' : 'Generate command')}</OutlineButton>
      {busy && <TextButton onClick={() => { request.current?.abort(); setBusy(false); }}>{t('Cancel')}</TextButton>}
      {draft && item && <>
        <OutlineButton disabled={!valid || busy || saving} onClick={() => void save(true)}>{t('Fill terminal input')}</OutlineButton>
        <OutlineButton disabled={!valid || busy || saving} onClick={() => void save(false)}>{t('Save as favorite')}</OutlineButton>
      </>}
    </div>}>
    <section className="command-history-composer" aria-label={t('Write a command')}>
    <ConfigTextArea data-command-composer-prompt font="ui" aria-label={t('Describe the command')} placeholder={t('Describe what to build or run…')} rows={3}
      value={prompt} onChange={event => setPrompt(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void generate(); } }} />
    {busy && <p role="status">{t('Writing command…')}</p>}
    {error && <ErrorBox title={t('Could not write the command')} actions={<TextButton onClick={onSettings}>{t('Configure AI model')}</TextButton>}>{error}</ErrorBox>}
    {draft && item && <>
      <ConfigTextArea label={t('Command draft')} rows={3} value={draft.command}
        onChange={event => setDraft({ ...draft, command: event.target.value })} />
      <label>{t('Execution directory')}<TextInput variant="field" aria-label={t('Execution directory')} value={draft.cwd}
        onChange={event => setDraft({ ...draft, cwd: event.target.value })} /></label>
      {draft.explanation && <div className="markdown-body command-history-explanation"><SafeMarkdown content={draft.explanation} paneId={context.paneId} /></div>}
      {!isWithin(item.cwd, context.root) && <p>{t('The execution directory must be inside this project.')}</p>}
    </>}
  </section></ToolWindow>;
}

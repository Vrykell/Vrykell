import { useState } from 'react';
import { t } from '@i18n';
import { TextInput } from '@ui/TextInput';
import Select from '@ui/Select';
import ErrorBox from '@ui/ErrorBox';
import { OutlineButton } from '@ui/OutlineButton';
import type { ProviderKind } from '@features/agent/services/provider';
import { Field } from './ui';

export interface CustomProviderDraft { name: string; provider: ProviderKind; baseUrl: string; model: string; key: string }
export default function CustomProviderFields({ onAdd }: { onAdd: (draft: CustomProviderDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<CustomProviderDraft>({ name: '', provider: 'openai-compatible', baseUrl: '', model: '', key: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const add = async () => {
    setError('');
    let url: URL;
    try { url = new URL(draft.baseUrl.trim()); } catch { setError(t('Enter a valid HTTP or HTTPS API address.')); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { setError(t('Enter a valid HTTP or HTTPS API address.')); return; }
    if (!draft.model.trim()) { setError(t('Fill in the model ID first.')); return; }
    setBusy(true);
    try { await onAdd({ ...draft, name: draft.name.trim(), model: draft.model.trim(), baseUrl: draft.baseUrl.trim() }); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="settings-custom-provider">
    <Field layout="stacked" title={t('Provider name')}><TextInput autoFocus variant="field" aria-label={t('Provider name')} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} disabled={busy} /></Field>
    <Field layout="stacked" title={t('API family')}><Select aria-label={t('API family')} value={draft.provider} options={[{ value: 'openai-compatible', label: 'OpenAI-compatible' }, { value: 'anthropic', label: 'Anthropic' }, { value: 'gemini', label: 'Gemini' }]} onChange={provider => setDraft({ ...draft, provider })} disabled={busy} /></Field>
    <Field layout="stacked" title={t('Base URL')}><TextInput variant="field" aria-label={t('Base URL')} value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} disabled={busy} /></Field>
    <Field layout="stacked" title={t('API Key')}><TextInput variant="field" type="password" aria-label={t('API Key')} value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value })} disabled={busy} /></Field>
    <Field layout="stacked" title={t('Model ID')}><TextInput variant="field" aria-label={t('Model ID')} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} disabled={busy} /></Field>
    {error && <ErrorBox title={t('Could not add provider')} details={error} />}
    <OutlineButton className="primary-button" disabled={busy} onClick={() => { void add(); }}>{t('Add provider')}</OutlineButton>
  </div>;
}

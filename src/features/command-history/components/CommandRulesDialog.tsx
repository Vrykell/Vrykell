import { useState } from 'react';
import { t } from '@i18n';
import type { HistoryCommandPreferences } from '@core/commandHistory';
import ToolDialog from '@ui/ToolDialog';
import { TextInput } from '@ui/TextInput';
import { TextButton } from '@ui/TextButton';
import { OutlineButton } from '@ui/OutlineButton';
import Select from '@ui/Select';
import ErrorBox from '@ui/ErrorBox';

/** Manage hidden entries and exclusions within the current project. */
export default function CommandRulesDialog({ preferences, initialRule, onChange, onClose }: {
  preferences: HistoryCommandPreferences; initialRule?: string;
  onChange: (change: (value: HistoryCommandPreferences) => HistoryCommandPreferences) => Promise<void>; onClose: () => void;
}) {
  const [ruleValue, setRuleValue] = useState(initialRule ?? '');
  const [ruleKind, setRuleKind] = useState<'name' | 'prefix'>('name');
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const update = (change: (value: HistoryCommandPreferences) => HistoryCommandPreferences) => {
    setError(''); void onChange(change).catch(reason => setError(String(reason)));
  };
  const addRule = () => {
    if (!ruleValue.trim()) return;
    update(value => ({ ...value, rules: [...value.rules.filter(rule => rule.id !== ruleId),
      { id: ruleId ?? crypto.randomUUID(), kind: ruleKind, value: ruleValue.trim() }] }));
    setRuleValue(''); setRuleId(null);
  };
  return <ToolDialog label={t('Hidden commands and exclusion rules')} onClose={onClose} initialFocus="input">
    <div className="command-history-tool">
      <Select aria-label={t('Exclusion rule type')} value={ruleKind} onChange={setRuleKind} options={[{ value: 'name', label: t('Command name') }, { value: 'prefix', label: t('Command prefix') }]} />
      <TextInput variant="field" aria-label={t('Exclude matching commands')} placeholder={t('For example: ls or npm run temporary')} value={ruleValue} onChange={event => setRuleValue(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addRule(); } }} />
      <OutlineButton onClick={addRule} disabled={!ruleValue.trim()}>{t(ruleId ? 'Save' : 'Add exclusion rule')}</OutlineButton>
      {ruleId && <TextButton onClick={() => { setRuleId(null); setRuleValue(''); }}>{t('Cancel')}</TextButton>}
      {preferences.rules.map(rule => <div className="command-history-rule" key={rule.id}>
        <span>{t(rule.kind === 'name' ? 'Command name' : 'Command prefix')}: {rule.value}</span>
        <TextButton onClick={() => { setRuleId(rule.id); setRuleKind(rule.kind); setRuleValue(rule.value); }}>{t('Edit')}</TextButton>
        <TextButton onClick={() => update(value => ({ ...value, rules: value.rules.filter(item => item.id !== rule.id) }))}>{t('Remove')}</TextButton>
      </div>)}
      <p>{t('Rules apply to project history. Favorites remain visible.')}</p>
      <h3>{t('Hidden commands')}</h3>
      {!preferences.hidden.length && <p>{t('No hidden commands')}</p>}
      {preferences.hidden.map(key => <div className="command-history-rule" key={key}>
        <span>{(() => { try { return (JSON.parse(key) as string[])[2]; } catch { return key; } })()}</span>
        <TextButton onClick={() => update(value => ({ ...value, hidden: value.hidden.filter(item => item !== key) }))}>{t('Restore')}</TextButton>
      </div>)}
      {error && <ErrorBox title={t('Could not load or save command history')} details={error} />}
    </div>
  </ToolDialog>;
}

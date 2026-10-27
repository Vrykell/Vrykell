import { useAgentSettings } from '@features/agent';
import Select from '@ui/fields/Select';
import { t } from '@i18n';
import { Toggle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const thinkingLevels = [
  { value: 'low', label: t('Low') },
  { value: 'medium', label: t('Medium') },
  { value: 'high', label: t('High') },
] as const;

export default function ModelThinkingSettings({ modelId, name }: { modelId: string; name: string }) {
  const settings = useAgentSettings();
  const behavior = settings.resolve(modelId);
  const { save } = useSettingsSave();
  return <div aria-label={t('Thinking settings for {{model}}', { model: name })} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
    <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))' }}>{t('Deep thinking')}</span>
    <Toggle on={behavior.deepThink} onChange={deepThink => { void save(() => settings.updateModel(modelId, { deepThink })); }} />
    {behavior.deepThink && <Select aria-label={t('Thinking effort for {{model}}', { model: name })} value={behavior.thinkingLevel} options={thinkingLevels}
      onChange={thinkingLevel => { void save(() => settings.updateModel(modelId, { thinkingLevel })); }} style={{ width: 90 }} />}
  </div>;
}

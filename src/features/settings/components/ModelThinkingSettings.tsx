import { useAgentSettings } from '@features/agent';
import Select from '@ui/fields/Select';
import { Toggle } from './ui';
import { useSettingsSave } from './SettingsSaveProvider';

const thinkingLevels = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const;

export default function ModelThinkingSettings({ modelId, name }: { modelId: string; name: string }) {
  const settings = useAgentSettings();
  const behavior = settings.resolve(modelId);
  const { save } = useSettingsSave();
  return <div aria-label={`${name}的思考设置`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
    <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))' }}>深度思考</span>
    <Toggle on={behavior.deepThink} onChange={deepThink => { void save(() => settings.updateModel(modelId, { deepThink })); }} />
    {behavior.deepThink && <Select aria-label={`${name}的思考强度`} value={behavior.thinkingLevel} options={thinkingLevels}
      onChange={thinkingLevel => { void save(() => settings.updateModel(modelId, { thinkingLevel })); }} style={{ width: 90 }} />}
  </div>;
}

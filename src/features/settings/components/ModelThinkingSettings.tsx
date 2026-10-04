import { useAgentSettings } from '@features/agent';
import { inputStyle, Toggle } from './ui';

export default function ModelThinkingSettings({ modelId, name }: { modelId: string; name: string }) {
  const settings = useAgentSettings();
  const behavior = settings.resolve(modelId);
  return <div aria-label={`${name}的思考设置`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
    <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))' }}>深度思考</span>
    <Toggle on={behavior.deepThink} onChange={deepThink => settings.updateModel(modelId, { deepThink })} />
    {behavior.deepThink && <select aria-label={`${name}的思考强度`} value={behavior.thinkingLevel}
      onChange={event => settings.updateModel(modelId, { thinkingLevel: event.target.value as 'low' | 'medium' | 'high' })}
      style={{ ...inputStyle, width: 'auto' }}>
      <option value="low">低</option>
      <option value="medium">中</option>
      <option value="high">高</option>
    </select>}
  </div>;
}

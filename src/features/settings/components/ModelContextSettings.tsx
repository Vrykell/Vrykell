import { t } from '@i18n';
import { useAgentSettings, type ModelBehaviorSettings } from '@features/agent';
import Select from '@ui/fields/Select';
import { NumberInput, Toggle, inputStyle } from './ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSettingsNavigationStore } from '../stores/navigation';
import AutoSaveInput from './AutoSaveInput';
import { useSettingsSave } from './SettingsSaveProvider';
import '../pages/resources.css';

export const MODEL_CONTEXT_FIELDS = ['Context strategy', 'Context token budget', 'Summary length limit', 'Tool output truncation', 'Reply token limit', 'Sampling temperature'];

function Option({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <div className="model-option" data-setting-title={title} role="group" aria-label={title}>
    <span data-tip={hint}>{title}</span><div>{children}</div>
  </div>;
}

/** Model limits retain the saved defaults until this model is explicitly configured. */
export default function ModelContextSettings({ modelId }: { modelId: string }) {
  const settings = useAgentSettings();
  const effective = settings.resolve(modelId);
  const { save } = useSettingsSave();
  const ref = useRef<HTMLDivElement>(null);
  const target = useSettingsNavigationStore(state => state.targetField);
  useEffect(() => {
    const row = [...(ref.current?.querySelectorAll<HTMLElement>('[data-setting-title]') ?? [])].find(row => row.dataset.settingTitle === target);
    row?.querySelector<HTMLElement>('input, button')?.focus();
  }, [target]);
  const update = (patch: Partial<ModelBehaviorSettings>) => settings.updateModel(modelId, patch);
  return <div ref={ref} className="model-context-settings" data-testid="model-context-settings">
    <div className="model-options-grid">
      <Option title={t('Context strategy')} hint={t('Keep all messages, recent messages or a summary of older messages.')}>
        <Select aria-label={t('Context strategy')} value={effective.contextStrategy}
          options={[{ value: 'off', label: t('All messages') }, { value: 'window', label: t('Window') }, { value: 'compact', label: t('Summary') }]}
          onChange={value => { void save(() => update({ contextStrategy: value })); }} />
      </Option>
      <Option title={t('Context token budget')} hint={t('Input budget for this model, including instructions, images and tools. Set it within the context window supported by your provider. Use 0 for no local limit.')}>
        <NumberInput label={t('Context token budget')} value={effective.contextMaxTokens} min={0} max={10000000} onChange={value => update({ contextMaxTokens: value })} />
      </Option>
      <Option title={t('Summary length limit')} hint={t('Maximum tokens in a context summary.')}>
        <NumberInput label={t('Summary length limit')} value={effective.contextSummaryTokens} min={64} max={8000} onChange={value => update({ contextSummaryTokens: value })} />
      </Option>
      <Option title={t('Tool output truncation')} hint={t('Maximum characters in the tool preview. Complete results are retained for conversation history.')}>
        <NumberInput label={t('Tool output truncation')} value={effective.contextToolChars} min={256} max={65536} onChange={value => update({ contextToolChars: value })} />
      </Option>
      <Option title={t('Reply token limit')} hint={t('Maximum reply tokens. Use 0 for the provider default.')}>
        <NumberInput label={t('Reply token limit')} value={effective.maxOutputTokens} min={0} max={1000000} onChange={value => update({ maxOutputTokens: value })} />
      </Option>
      <Option title={t('Sampling temperature')} hint={t('Response randomness. Turn off to use the provider default.')}>
        <div className="model-temperature-controls">
          <Toggle on={effective.temperature != null} onChange={on => update({ temperature: on ? 0.7 : null })} />
          {effective.temperature != null && <AutoSaveInput type="number" aria-label={t('Sampling temperature')} step={0.1} min={0} max={2}
            value={String(effective.temperature)} style={{ ...inputStyle, width: 80 }}
            onCommit={next => { const value = Number(next); if (Number.isFinite(value)) update({ temperature: Math.min(2, Math.max(0, value)) }); }} />}
        </div>
      </Option>
    </div>
  </div>;
}

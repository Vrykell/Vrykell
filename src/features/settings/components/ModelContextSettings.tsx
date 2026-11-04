import { t } from '@i18n';
import { useAgentSettings, type ModelBehaviorSettings } from '@features/agent';
import Select from '@ui/fields/Select';
import { Field, NumberInput, Toggle, inputStyle } from './ui';
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
export default function ModelContextSettings({ modelId, global = false, focusTargets = true }: { modelId?: string; global?: boolean; focusTargets?: boolean }) {
  const settings = useAgentSettings();
  const effective = settings.resolve(global ? undefined : modelId);
  const { save } = useSettingsSave();
  const ref = useRef<HTMLDivElement>(null);
  const target = useSettingsNavigationStore(state => state.targetField);
  useEffect(() => {
    if (!focusTargets) return;
    const row = [...(ref.current?.querySelectorAll<HTMLElement>('[data-setting-title]') ?? [])].find(row => row.dataset.settingTitle === target);
    row?.querySelector<HTMLElement>('input, button')?.focus();
  }, [target, focusTargets]);
  const update = (patch: Partial<ModelBehaviorSettings>) => global ? settings.update(patch) : settings.updateModel(modelId ?? '', patch);
  const fields = [
    {
      title: t('Context strategy'),
      description: t('Keep all messages, recent messages or a summary of older messages.'),
      control: <Select aria-label={t('Context strategy')} value={effective.contextStrategy} style={{ width: '100%' }}
        options={[{ value: 'off', label: t('All messages') }, { value: 'window', label: t('Window') }, { value: 'compact', label: t('Summary') }]}
        onChange={value => { void save(() => update({ contextStrategy: value })); }} />,
    },
    {
      title: t('Context token budget'),
      description: t('Input budget for this model, including instructions, images and tools. Set it within the context window supported by your provider. Use 0 for no local limit.'),
      control: <NumberInput label={t('Context token budget')} value={effective.contextMaxTokens} min={0} max={10000000} onChange={value => update({ contextMaxTokens: value })} />,
    },
    {
      title: t('Summary length limit'),
      description: t('Maximum tokens in a context summary.'),
      control: <NumberInput label={t('Summary length limit')} value={effective.contextSummaryTokens} min={64} max={8000} onChange={value => update({ contextSummaryTokens: value })} />,
    },
    {
      title: t('Tool output truncation'),
      description: t('Maximum characters in the tool preview. Complete results are retained for conversation history.'),
      control: <NumberInput label={t('Tool output truncation')} value={effective.contextToolChars} min={256} max={65536} onChange={value => update({ contextToolChars: value })} />,
    },
    {
      title: t('Reply token limit'),
      description: t('Maximum reply tokens. Use 0 for the provider default.'),
      control: <NumberInput label={t('Reply token limit')} value={effective.maxOutputTokens} min={0} max={1000000} onChange={value => update({ maxOutputTokens: value })} />,
    },
    {
      title: t('Sampling temperature'),
      description: t('Response randomness. Turn off to use the provider default.'),
      control: <div className="model-temperature-controls">
        <Toggle showState={false} on={effective.temperature != null} onChange={on => update({ temperature: on ? 0.7 : null })} />
        {effective.temperature != null && <AutoSaveInput type="number" aria-label={t('Sampling temperature')} step={0.1} min={0} max={2}
          value={String(effective.temperature)} style={{ ...inputStyle, width: global ? 96 : 64 }}
          onCommit={next => { const value = Number(next); if (Number.isFinite(value)) update({ temperature: Math.min(2, Math.max(0, value)) }); }} />}
      </div>,
    },
  ];
  if (global) {
    return <>{fields.map(field => <Field key={field.title} title={field.title} description={field.description}>{field.control}</Field>)}</>;
  }
  return <div ref={ref} className="model-context-settings" data-testid="model-context-settings">
    <div className="model-options-grid">
      {fields.map(field => <Option key={field.title} title={field.title} hint={field.description}>{field.control}</Option>)}
    </div>
  </div>;
}

import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';
import KeyHint from '@ui/feedback/KeyHint';
/**
 * Global behavior defaults and per-model overrides.
 */
import { useState } from 'react';
import { useAiConfigStore, useAgentSettings, type AgentSettings, type ModelBehaviorSettings } from '@features/agent';
import { ModelScopeBar } from '@features/chat/components/ModelPicker';
import { SettingsGroup, Field, Toggle, NumberInput, inputStyle } from '@features/settings/components/ui';
import AutoSaveInput from '../components/AutoSaveInput';

export function AiBehaviorPage() {
  const models = useAiConfigStore((s) => s.models);
  const agentSettings = useAgentSettings();
  const [scope, setScope] = useState<string>('global');

  const isGlobal = scope === 'global';
  const model = models.find((m) => m.id === scope) ?? null;
  const eff = agentSettings.resolve(isGlobal ? undefined : scope);
  const behaviorFields: (keyof ModelBehaviorSettings)[] = ['systemPrompt', 'agentMode', 'maxSteps'];
  const overrideKeys = !isGlobal && model ? Object.keys(agentSettings.overrides[model.id] ?? {}).filter(key => behaviorFields.includes(key as keyof ModelBehaviorSettings)) : [];
  const hasOverride = overrideKeys.length > 0;

  const update = (patch: Partial<AgentSettings>) => {
    if (isGlobal) agentSettings.update(patch);
    else if (model) agentSettings.updateModel(model.id, patch as Partial<ModelBehaviorSettings>);
  };

  return (
    <>
      <SettingsGroup title={t('Instructions')}>
        <Field
          title={t('Configuration scope')}
          description={t("Apply these options globally or to one model.")}
        >
          <ModelScopeBar
            options={models.map((m) => ({ value: m.id, label: m.name || m.model }))}
            value={scope === 'global' ? '' : scope}
            onChange={(v) => setScope(v === '' ? 'global' : v)}
          />
        </Field>

        {!isGlobal && model && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', marginBottom: 8, borderRadius: 'var(--radius-inner)',
            background: hasOverride ? 'var(--accent-warm-dim)' : 'var(--hover)',
            fontSize: 'calc(11px * var(--ui-font-scale))', color: hasOverride ? 'var(--accent-warm)' : 'var(--text-muted)',
          }}>
            <span>{hasOverride ? t('Overrides {{count}} settings', { count: overrideKeys.length }) : t('Uses global defaults')}</span>
            <div style={{ flex: 1 }} />
            {hasOverride && (
              <OutlineButton data-subtle onClick={() => agentSettings.resetModelFields(model.id, behaviorFields)} >
                {t('Reset to global defaults')}
              </OutlineButton>
            )}
          </div>
        )}

        <Field
          layout="stacked"
          title={t('System prompt')}
          description={t('AI instructions. Leave empty for the default.')}
        >
          <AutoSaveInput
            key={`prompt-${scope}`}
            multiline
            aria-label={t('System prompt')}
            trim={false}
            value={eff.systemPrompt ?? ''}
            placeholder={t('Leave empty for the built-in prompt')}
            onCommit={systemPrompt => update({ systemPrompt })}
            rows={8}
            style={{
              ...inputStyle,
              minHeight: 130,
              fontFamily: 'var(--font-ui)',
              lineHeight: 1.6,
            }}
          />
        </Field>

      </SettingsGroup>
      <SettingsGroup title={t('Tools')}>
        <Field title={t('Agent mode')} description={t("Allow AI to use tools.")}>
          <Toggle on={eff.agentMode} onChange={(v) => update({ agentMode: v })} />
        </Field>
        <Field title={t('Maximum iterations')} description={t("Maximum tool rounds per response, from 1 to 100.")}>
          <NumberInput key={scope} value={eff.maxSteps} min={1} max={100} onChange={(v) => update({ maxSteps: v })} />
        </Field>
      </SettingsGroup>
      {isGlobal && (
        <>
          <SettingsGroup title={t('Session titles')}>
            <Field title={t('Automatic session titles')} description={t('Generate titles without replacing custom names.')}>
              <Toggle on={eff.autoTitle} onChange={(v) => update({ autoTitle: v })} />
            </Field>
            <Field title={t('Title model')} description={t("Model for titles. Leave empty to use the chat model.")}>
              <AutoSaveInput
                value={eff.titleModel}
                placeholder={t('Use the chat model')}
                onCommit={titleModel => update({ titleModel })}
                style={inputStyle}
              />
            </Field>
          </SettingsGroup>
          <SettingsGroup title={t('Completion preferences')}>
            <Field title={t('Command completion')} description={<>{t('Suggest completions while typing commands.')}<span className="composer-key-hints settings-completion-keys"><KeyHint shortcut="Tab" />{t('Accept')}<KeyHint shortcut="Escape" />{t('Dismiss')}</span></>}>
              <Toggle on={eff.completeEnabled} onChange={(v) => update({ completeEnabled: v })} />
            </Field>
            <Field title={t('Completion debounce')} description={t('Wait 100–2000 ms before suggesting completions.')}>
              <NumberInput key={scope} value={eff.completeDebounceMs} min={100} max={2000} onChange={(v) => update({ completeDebounceMs: v })} />
            </Field>
            <Field title={t('Completion model')} description={t("Model for completion. Leave empty to use the chat model.")}>
              <AutoSaveInput
                value={eff.completeModel}
                placeholder={t('Use the chat model')}
                onCommit={completeModel => update({ completeModel })}
                style={inputStyle}
              />
            </Field>
          </SettingsGroup>
        </>
      )}
    </>
  );
}

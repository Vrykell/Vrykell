import { useSettingsNavigationStore } from '../stores/navigation';
import { t } from '@i18n';
import KeyHint from '@ui/KeyHint';
/**
 * Global behavior defaults and per-model overrides.
 */
import { useState } from 'react';
import { useAiConfigStore, useAgentSettings, type AgentSettings, type ModelBehaviorSettings } from '@features/agent';
import Select from '@ui/Select';
import { ModelScopeBar } from '@features/chat/components/ModelPicker';
import { SettingsGroup, Field, Toggle, NumberInput, inputStyle, btnStyle } from '@features/settings/components/ui';
import AutoSaveInput from '../components/AutoSaveInput';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function AiBehaviorPage() {
  const targetField = useSettingsNavigationStore(state => state.targetField);
  const models = useAiConfigStore((s) => s.models);
  const agentSettings = useAgentSettings();
  const [scope, setScope] = useState<string>('global');
  const { save } = useSettingsSave();

  const isGlobal = scope === 'global';
  const model = models.find((m) => m.id === scope) ?? null;
  const eff = agentSettings.resolve(isGlobal ? undefined : scope);
  const overrideKeys = !isGlobal && model ? Object.keys(agentSettings.overrides[model.id] ?? {}) : [];
  const hasOverride = overrideKeys.length > 0;

  const update = (patch: Partial<AgentSettings>) => {
    if (isGlobal) agentSettings.update(patch);
    else if (model) agentSettings.updateModel(model.id, patch as Partial<ModelBehaviorSettings>);
  };

  return (
    <>
      <SettingsGroup title={t('Instructions')}>
        <Field
          title="配置作用域"
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
            <span>{hasOverride ? `已覆盖 ${overrideKeys.length} 项` : '跟随全局默认'}</span>
            <div style={{ flex: 1 }} />
            {hasOverride && (
              <button data-subtle onClick={() => agentSettings.resetModel(model.id)} style={btnStyle}>
                重置为全局默认
              </button>
            )}
          </div>
        )}

        <Field
          layout="stacked"
          title="系统提示词"
          description={t('AI instructions. Leave empty for the default.')}
        >
          <AutoSaveInput
            key={`prompt-${scope}`}
            multiline
            aria-label={t('System prompt')}
            trim={false}
            value={eff.systemPrompt ?? ''}
            placeholder="留空使用内置默认提示词"
            onCommit={systemPrompt => update({ systemPrompt })}
            rows={8}
            style={{
              ...inputStyle,
              minHeight: 130,
              resize: 'vertical',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.6,
            }}
          />
        </Field>

      </SettingsGroup>
      <SettingsGroup title={t('Tools and context')}>
        <Field title="Agent 模式" description={t("Allow AI to use tools.")}>
          <Toggle on={eff.agentMode} onChange={(v) => update({ agentMode: v })} />
        </Field>
        <Field title="最大迭代步数" description={t("Maximum tool rounds per response, from 1 to 100.")}>
          <NumberInput key={scope} value={eff.maxSteps} min={1} max={100} onChange={(v) => update({ maxSteps: v })} />
        </Field>
        <Field title="上下文策略" description={t("Keep all messages, recent messages or a summary of older messages.")}>
          <Select
            aria-label="上下文策略"
            options={[
              { value: 'off', label: '全量' },
              { value: 'window', label: '窗口' },
              { value: 'compact', label: '摘要' },
            ]}
            value={eff.contextStrategy}
            onChange={(v) => { void save(() => update({ contextStrategy: v })); }}
          />
        </Field>
        <Field title="上下文 Token 预算" description={t("Limit context tokens. Use 0 for no limit.")}>
          <NumberInput key={scope} value={eff.contextMaxTokens} min={0} max={1000000} onChange={(v) => update({ contextMaxTokens: v })} />
        </Field>
        {(eff.contextStrategy === 'compact' || targetField === t('Summary length limit')) && (
          <Field title="摘要长度上限" description={t('Maximum tokens in a context summary.')}>
            <NumberInput key={scope} value={eff.contextSummaryTokens} min={64} max={8000} onChange={(v) => update({ contextSummaryTokens: v })} />
          </Field>
        )}
        <Field title="工具输出截断" description={t('Maximum characters per tool result.')}>
          <NumberInput key={scope} value={eff.contextToolChars} min={256} max={65536} onChange={(v) => update({ contextToolChars: v })} />
        </Field>
      </SettingsGroup>
      <SettingsGroup title={t('Responses')}>
        <Field title="回复 Token 上限" description={t('Maximum reply tokens. Use 0 for the provider default.')}>
          <NumberInput key={scope} value={eff.maxOutputTokens} min={0} max={32768} onChange={(v) => update({ maxOutputTokens: v })} />
        </Field>
        <Field title="采样温度" description={t("Response randomness. Turn off to use the provider default.")}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle on={eff.temperature != null} onChange={(v) => update({ temperature: v ? 0.7 : null })} />
            {eff.temperature != null && (
              <AutoSaveInput
                key={`temperature-${scope}`}
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={String(eff.temperature)}
                onCommit={next => {
                  const n = Number(next);
                  if (Number.isFinite(n)) return update({ temperature: Math.min(2, Math.max(0, n)) });
                }}
                style={{ ...inputStyle, width: 100 }}
              />
            )}
          </div>
        </Field>

      </SettingsGroup>
      {isGlobal && (
        <>
          <SettingsGroup title={t('Session titles')}>
            <Field title="智能会话标题" description={t('Generate titles without replacing custom names.')}>
              <Toggle on={eff.autoTitle} onChange={(v) => update({ autoTitle: v })} />
            </Field>
            <Field title="标题模型" description={t("Model for titles. Leave empty to use the chat model.")}>
              <AutoSaveInput
                value={eff.titleModel}
                placeholder="沿用聊天模型"
                onCommit={titleModel => update({ titleModel })}
                style={inputStyle}
              />
            </Field>
          </SettingsGroup>
          <SettingsGroup title={t('Completion preferences')}>
            <Field title="命令自动补全" description={<>{t('Suggest completions while typing commands.')}<span className="composer-key-hints settings-completion-keys"><KeyHint shortcut="Tab" />{t('Accept')}<KeyHint shortcut="Escape" />{t('Dismiss')}</span></>}>
              <Toggle on={eff.completeEnabled} onChange={(v) => update({ completeEnabled: v })} />
            </Field>
            <Field title="补全防抖" description={t('Wait 100–2000 ms before suggesting completions.')}>
              <NumberInput key={scope} value={eff.completeDebounceMs} min={100} max={2000} onChange={(v) => update({ completeDebounceMs: v })} />
            </Field>
            <Field title="补全模型" description={t("Model for completion. Leave empty to use the chat model.")}>
              <AutoSaveInput
                value={eff.completeModel}
                placeholder="沿用聊天模型"
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

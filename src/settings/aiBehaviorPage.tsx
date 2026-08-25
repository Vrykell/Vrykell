/**
 * aiBehaviorPage — AI 行为设置（全局默认 + 每模型覆盖）。
 */
import { useState } from 'react';
import { useAiConfigStore } from '../lib/ai';
import { useAgentSettings, type AgentSettings, type ModelBehaviorSettings } from '../agent/agentSettings';
import Segmented from '../components/Segmented';
import { Field, Toggle, NumberInput, inputStyle, btnStyle } from './ui';

export function AiBehaviorPage() {
  const models = useAiConfigStore((s) => s.models);
  const agentSettings = useAgentSettings();
  const [scope, setScope] = useState<string>('global');

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
      <Field
        title="作用域"
        description="全局默认对所有模型生效；选中模型可单独覆盖。"
      >
        <Segmented
          options={[
            { value: 'global', label: '全局默认' },
            ...models.map((m) => ({ value: m.id, label: m.name || m.model })),
          ]}
          value={scope}
          onChange={(v) => setScope(v)}
        />
      </Field>

      {!isGlobal && model && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', marginBottom: 8, borderRadius: 'var(--radius-inner)',
          background: hasOverride ? 'var(--accent-warm-dim)' : 'var(--hover)',
          fontSize: 11, color: hasOverride ? 'var(--accent-warm)' : 'var(--text-muted)',
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
        title="系统提示词"
        description="定义 AI 的角色与行为，留空使用内置默认。"
      >
        <textarea
          value={eff.systemPrompt ?? ''}
          placeholder="留空使用内置默认提示词"
          onChange={(e) => update({ systemPrompt: e.target.value })}
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

      <Field title="Agent 模式" description="开启后 AI 可调用工具；关闭则为纯聊天。">
        <Toggle on={eff.agentMode} onChange={(v) => update({ agentMode: v })} />
      </Field>
      <Field title="深度思考" description="提高推理强度，适合复杂问题。">
        <Toggle on={eff.deepThink} onChange={(v) => update({ deepThink: v })} />
      </Field>
      <Field title="最大迭代步数" description="Agent 一次回答最多调用多少轮工具；1–100。">
        <NumberInput value={eff.maxSteps} min={1} max={100} onChange={(v) => update({ maxSteps: v })} />
      </Field>
      <Field title="上下文策略" description="全量不裁剪；窗口按预算保留最近消息；摘要压缩旧消息。">
        <Segmented
          options={[
            { value: 'off', label: '全量' },
            { value: 'window', label: '窗口' },
            { value: 'compact', label: '摘要' },
          ]}
          value={eff.contextStrategy}
          onChange={(v) => update({ contextStrategy: v })}
        />
      </Field>
      <Field title="上下文 Token 预算" description="估算的上下文 token 预算；0 = 不设限。超预算时按上面的策略裁剪或压缩。">
        <NumberInput value={eff.contextMaxTokens} min={0} max={1000000} onChange={(v) => update({ contextMaxTokens: v })} />
      </Field>
      {eff.contextStrategy === 'compact' && (
        <Field title="摘要长度上限" description="压缩摘要的最大 token 数。">
          <NumberInput value={eff.contextSummaryTokens} min={64} max={8000} onChange={(v) => update({ contextSummaryTokens: v })} />
        </Field>
      )}
      <Field title="工具输出截断" description="单个工具结果的最大字符数，超长截断避免占满上下文。">
        <NumberInput value={eff.contextToolChars} min={256} max={65536} onChange={(v) => update({ contextToolChars: v })} />
      </Field>
      <Field title="回复 Token 上限" description="单次回复的最大 token 数，0 为服务商默认。">
        <NumberInput value={eff.maxOutputTokens} min={0} max={32768} onChange={(v) => update({ maxOutputTokens: v })} />
      </Field>
      <Field title="采样温度" description="控制输出随机性；关闭 = 使用服务商默认。">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle on={eff.temperature != null} onChange={(v) => update({ temperature: v ? 0.7 : null })} />
          {eff.temperature != null && (
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={eff.temperature}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) update({ temperature: Math.min(2, Math.max(0, n)) });
              }}
              style={{ ...inputStyle, width: 100 }}
            />
          )}
        </div>
      </Field>

      {isGlobal && (
        <>
          <Field title="智能会话标题" description="内容足够时自动生成标题，手动改过的名字不覆盖。">
            <Toggle on={eff.autoTitle} onChange={(v) => update({ autoTitle: v })} />
          </Field>
          <Field title="标题模型" description="生成标题用的模型；留空 = 沿用聊天模型。">
            <input
              value={eff.titleModel}
              placeholder="沿用聊天模型"
              onChange={(e) => update({ titleModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field title="命令自动补全" description="在终端输入命令时给出补全建议，Tab 接受，Esc 丢弃。">
            <Toggle on={eff.completeEnabled} onChange={(v) => update({ completeEnabled: v })} />
          </Field>
          <Field title="补全防抖" description="触发补全的停顿毫秒数，100–2000。">
            <NumberInput value={eff.completeDebounceMs} min={100} max={2000} onChange={(v) => update({ completeDebounceMs: v })} />
          </Field>
          <Field title="补全模型" description="AI 增强补全用的模型；留空 = 沿用聊天模型。">
            <input
              value={eff.completeModel}
              placeholder="沿用聊天模型"
              onChange={(e) => update({ completeModel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </>
      )}
    </>
  );
}

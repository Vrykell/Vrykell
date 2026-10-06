/**
 * aiModelPage — 模型配置页（API Key + 模型列表）。
 */
import { Plus, X } from '@ui/icons';
import {
  setProviderKey, clearProviderKey, setAiModels, setActiveModel, useAiConfigStore,
  type ModelProfile,
} from '@features/agent';
import type { ProviderKind } from '@features/agent/services/provider';
import { baseUrlForProvider } from '@features/agent/services/provider';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { modelIcon, providerLabel } from '@features/agent/components/modelIcon';
import Select from '@ui/Select';
import { useToastStore } from '@ui/Toast';
import { Field, ModelTextInput, btnStyle } from '@features/settings/components/ui';
import ModelThinkingSettings from '@features/settings/components/ModelThinkingSettings';
import AutoSaveInput from '../components/AutoSaveInput';
import { useSettingsSave } from '../components/SettingsSaveProvider';

const PROVIDERS: { id: ProviderKind; label: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
];

/** Serialize model edits and merge each patch with the latest persisted list. */
let modelWrites = Promise.resolve();
function commitModels(transform: (models: ModelProfile[]) => ModelProfile[]) {
  const write = modelWrites.then(() => {
    const current = useAiConfigStore.getState();
    const next = transform(current.models);
    return setAiModels(next, next.some(model => model.id === current.activeModel) ? current.activeModel : next[0]!.id);
  });
  modelWrites = write.catch(() => {});
  return write;
}

function selectModel(id: string) {
  const write = modelWrites.then(() => setActiveModel(id));
  modelWrites = write.catch(() => {});
  return write;
}

/** 能力徽标行（视觉/推理/工具/搜索，探测结果） */
function CapChips({ profile }: { profile: ModelProfile }) {
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {(
        [
          ['vision', '视觉'],
          ['reasoning', '推理'],
          ['tools', '工具'],
          ['search', '搜索'],
        ] as [ModelCapability, string][]
      ).map(([cap, label]) => (
        <span
          key={cap}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'calc(10px * var(--ui-font-scale))', lineHeight: '14px', padding: '1px 6px', borderRadius: 4,
            color: caps[cap] ? 'var(--text-secondary)' : 'var(--text-muted)',
            background: caps[cap] ? 'var(--hover)' : 'transparent',
            border: caps[cap] ? 'none' : '1px solid var(--border)',
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function AiModelPage() {
  const aiCfg = useAiConfigStore();
  const provider = aiCfg.provider;
  const keySet =
    provider === 'anthropic' ? aiCfg.hasAnthropicKey
    : provider === 'gemini' ? aiCfg.hasGeminiKey
    : aiCfg.hasKey;
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  return (
    <>
      <Field
        title="服务商 API Key"
        description="Key 按服务商共用：同一服务商下的多个模型复用同一个 Key。仅保存在本机后端，界面不回显明文。此处显示「当前模型」所在服务商。"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4,
            color: keySet ? 'var(--success)' : 'var(--text-muted)',
            background: keySet ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {keySet ? '已配置' : '未配置'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <AutoSaveInput
            key={provider}
            type="password"
            value=""
            placeholder={keySet ? '输入以覆盖，留空不改动' : '输入 API Key'}
            onCommit={key => setProviderKey(provider, key)}
            clearAfterSave
            onClear={keySet ? async () => { await clearProviderKey(provider); toast('已清除 API Key', 'success'); } : undefined}
            validate={key => key.trim() ? undefined : '留空不改动'}
            style={{ flex: 1 }}
          />
        </div>
      </Field>

      <ModelListField />
    </>
  );
}

function ModelListField() {
  const models = useAiConfigStore((s) => s.models);
  const activeId = useAiConfigStore((s) => s.activeModel);
  const { save } = useSettingsSave();
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const update = (id: string, patch: Partial<ModelProfile>) =>
    commitModels(
      current => current.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        // Recalculate capabilities when the provider or model identifier changes.
        if (patch.model !== undefined || patch.provider !== undefined) {
          next.capabilities = detectCapabilities(next.provider, next.model);
        }
        return next;
      }),
    );

  const remove = (id: string) => {
    if (models.length <= 1) {
      toast('至少保留一个模型', 'info');
      return;
    }
    void save(() => commitModels(current => current.filter((m) => m.id !== id)));
  };

  const add = () => {
    const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    void save(() => commitModels(
      current => [
        ...current,
        {
          id,
          name: `模型 ${models.length + 1}`,
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: '',
          capabilities: detectCapabilities('openai-compatible', ''),
        },
      ],
    ));
  };

  return (
    <Field
      title="模型列表"
      description="配置多个模型，每个模型独立服务商 / 服务地址 / 模型名；点「设为当前」切换生效。API Key 按服务商共用。"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {models.map((m) => (
          <div
            key={m.id}
            style={{
              borderRadius: 'var(--radius-inner)',
              padding: '12px 14px', background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                data-tip={providerLabel(m.provider)}
                style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--block)', color: 'var(--text-secondary)',
                }}
              >
                {(() => {
                  const Icon = modelIcon(m.provider, m.model);
                  return <Icon size={14} />;
                })()}
              </span>
              <ModelTextInput
                value={m.name}
                placeholder="模型名称"
                onCommit={(v) => update(m.id, { name: v })}
                style={{ flex: 1, fontWeight: 600 }}
              />
              {m.id === activeId ? (
                <span style={{
                  fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                  color: 'var(--success)', background: 'var(--success-bg)',
                }}>
                  当前
                </span>
              ) : (
                <button data-subtle onClick={() => { void save(() => selectModel(m.id)); }} style={btnStyle}>
                  设为当前
                </button>
              )}
              <button
                data-subtle
                onClick={() => remove(m.id)}
                data-tip="删除模型"
                aria-label="删除模型"
                style={{
                  width: 24, height: 24, flexShrink: 0, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  border: '1px solid transparent', borderRadius: 4, background: 'transparent',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Select
                aria-label={`${m.name || '未命名模型'} 提供方`}
                options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                value={m.provider}
                onChange={(v) => { void save(() => update(m.id, { provider: v, baseUrl: baseUrlForProvider(m.baseUrl, v) })); }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <ModelTextInput
                value={m.baseUrl}
                placeholder="服务地址 (Base URL)"
                onCommit={(v) => update(m.id, { baseUrl: v })}
                style={{ flex: 1 }}
              />
              <ModelTextInput
                value={m.model}
                placeholder="模型 ID"
                onCommit={(v) => update(m.id, { model: v })}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <CapChips profile={m} />
            </div>
            <ModelThinkingSettings modelId={m.id} name={m.name || m.model} />
          </div>
        ))}
        <button
          data-subtle
          onClick={add}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> 添加模型
        </button>
      </div>
    </Field>
  );
}

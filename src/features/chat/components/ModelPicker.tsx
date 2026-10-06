/**
 * ModelPicker — 页面化模型选择窗口。
 *
 * 点击任何「模型按钮」打开：顶部搜索框（按名称/模型 ID 过滤）→
 * 能力标签过滤区（视觉/推理/工具/搜索，多选）→ 模型列表项
 * （图标 + 名称 + 服务商 + 能力徽标；每项可独立调思考强度与
 * Agent 开关；点击列表项选中模型并关窗）。
 *
 * 同文件导出 ModelScopeBar：设置页「按模型配置」用的模型选择条。
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconSizes, Bot, BrainCircuit, ChevronDown, Eye, Globe, Search, SlidersHorizontal, Wrench, X  } from '@ui/icons';
import { useAiConfigStore, setActiveModel, type ModelProfile, useAgentSettings } from '@features/agent';
import {
  CAPABILITY_LABELS, detectCapabilities, hasCapability,
  type ModelCapability,
} from '@features/agent/model/capabilities';
import { modelIcon, providerLabel } from '@features/agent/components/modelIcon';
import { useToastStore } from '@ui/Toast';
import Select from '@ui/Select';

const CAP_ORDER: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

// ── 样式 ──

const pill: React.CSSProperties = {
  padding: '3px 10px', fontSize: 'calc(11px * var(--ui-font-scale))', border: '1px solid var(--border)',
  borderRadius: 999, background: 'transparent', color: 'var(--text-secondary)',
  cursor: 'pointer', flexShrink: 0,
};
const pillOn: React.CSSProperties = {
  ...pill,
  background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)',
};

function CapBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'calc(10px * var(--ui-font-scale))', lineHeight: '14px', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
        color: on ? 'var(--text-secondary)' : 'var(--text-muted)',
        background: on ? 'var(--hover)' : 'transparent',
        border: on ? 'none' : '1px solid var(--border)',
      }}
    >
      {label}
    </span>
  );
}

/** 每模型快速调整：思考强度（AI 面板已具备 Agent 开关，这里只留强度）。 */
function ItemControls({ profile }: { profile: ModelProfile }) {
  const agentSettings = useAgentSettings();
  const eff = agentSettings.resolve(profile.id);
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);

  if (!caps.reasoning) return null;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
      onClick={(e) => e.stopPropagation()}
      data-tip="思考强度"
    >
      <SlidersHorizontal size={iconSizes.compact} style={{ color: 'var(--text-muted)' }} />
      <Select<'low' | 'medium' | 'high'>
        aria-label={`${profile.name || profile.model}的思考强度`}
        value={eff.thinkingLevel}
        onChange={(thinkingLevel) =>
          agentSettings.updateModel(profile.id, { thinkingLevel })
        }
        options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}
        style={{ width: 84, background: 'var(--canvas)' }}
      />
    </div>
  );
}

// ── 模型选择窗口 ──

export default function ModelPicker({ open, onClose, showThinking = true }: { open: boolean; onClose: () => void; showThinking?: boolean }) {
  const models = useAiConfigStore((s) => s.models);
  const activeModel = useAiConfigStore((s) => s.activeModel);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<Set<ModelCapability>>(new Set());
  const toast = (msg: string) => useToastStore.getState().addToast(msg, 'success');

  useEffect(() => {
    if (open) {
      setQuery('');
      setTags(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.model.toLowerCase().includes(q)) return false;
      for (const cap of tags) {
        if (!hasCapability(m.capabilities, cap, m.provider, m.model)) return false;
      }
      return true;
    });
  }, [models, query, tags]);

  const toggleTag = (cap: ModelCapability) =>
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });

  if (!open) return null;

  return createPortal(
    <div
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'var(--overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'overlayIn 0.18s var(--ease)',
        }}
        onClick={onClose}
      >
        <div className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label="选择模型"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 480, maxWidth: 'calc(100vw - 48px)', maxHeight: 'min(560px, 80vh)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            animation: 'modalIn 0.22s var(--ease-out)',
          }}
        >
        {/* 顶部：标题 + 搜索框 */}
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 600, flex: 1 }}>选择模型</span>
            <button
              data-subtle
              data-tip="关闭"
              aria-label="关闭"
              onClick={onClose}
              style={{
                border: 'none', background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', padding: 0, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={iconSizes.control} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 10px', background: 'var(--canvas)' }}>
            <Search size={iconSizes.control} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* 能力标签过滤区 */}
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 10px', flexWrap: 'wrap' }}>
          {CAP_ORDER.map((cap) => {
            const TagIcon =
              cap === 'vision' ? Eye : cap === 'reasoning' ? BrainCircuit : cap === 'tools' ? Wrench : Globe;
            return (
              <button
                key={cap}
                onClick={() => toggleTag(cap)}
                style={{
                  ...(tags.has(cap) ? pillOn : pill),
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                <TagIcon size={iconSizes.compact} />
                {CAPABILITY_LABELS[cap]}
              </button>
            );
          })}
        </div>

        {/* 模型列表 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
          {list.length === 0 && (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
              无匹配模型
            </div>
          )}
          {list.map((m) => {
            const Icon = modelIcon(m.provider, m.model);
            const caps = m.capabilities ?? detectCapabilities(m.provider, m.model);
            const active = m.id === activeModel;
            return (
              <div
                key={m.id}
                data-testid={`model-pick-${m.id}`}
                className="workspace-floating-row"
                data-selected={active}
                onClick={() => {
                  void setActiveModel(m.id).then(() => {
                    toast(`已切换到 ${m.name || m.model}`);
                    onClose();
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'var(--hover)' : 'var(--block)',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <Icon size={iconSizes.row} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--text-primary)' }}>{m.name || m.model}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <span style={{ fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', marginRight: 2 }}>
                      {providerLabel(m.provider)}
                    </span>
                    {CAP_ORDER.map((cap) => (
                      <CapBadge key={cap} on={caps[cap]} label={CAPABILITY_LABELS[cap]} />
                    ))}
                  </div>
                </div>
                {showThinking && <ItemControls profile={m} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 设置页模型选择条（按模型配置的作用域选择） ──

export function ModelScopeBar({
  options,
  value,
  onChange,
}: {
  /** 选项：value 为 '' 表示全局默认 */
  options: { value: string; label: string; provider?: ModelProfile['provider']; model?: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        data-testid="model-scope-bar"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', fontSize: 'calc(12px * var(--ui-font-scale))', border: '1px solid var(--border)',
          borderRadius: 8, background: 'var(--canvas)', color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        {cur?.provider && cur.model ? (() => {
          const Icon = modelIcon(cur.provider, cur.model);
          return <Icon size={iconSizes.control} style={{ color: 'var(--text-secondary)' }} />;
        })() : <Bot size={iconSizes.control} style={{ color: 'var(--text-muted)' }} />}
        {cur?.label ?? '全局默认'}
        <ChevronDown size={iconSizes.compact} style={{ color: 'var(--text-muted)' }} />
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div className="workspace-floating"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
              minWidth: 200, padding: '4px',
            }}
          >
            <button
              className="workspace-floating-row" data-selected={value === ''}
              onClick={() => { onChange(''); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '6px 8px', fontSize: 'calc(12px * var(--ui-font-scale))', textAlign: 'left',
                border: 'none', borderRadius: 'var(--radius-inner)', cursor: 'pointer',
                color: value === '' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Bot size={iconSizes.control} style={{ color: 'var(--text-muted)' }} />
              全局默认
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                className="workspace-floating-row" data-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '6px 8px', fontSize: 'calc(12px * var(--ui-font-scale))', textAlign: 'left',
                  border: 'none', borderRadius: 'var(--radius-inner)', cursor: 'pointer',
                  color: o.value === value ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {o.provider && o.model ? (() => {
                  const Icon = modelIcon(o.provider, o.model);
                  return <Icon size={iconSizes.control} style={{ color: 'var(--text-secondary)' }} />;
                })() : <Bot size={iconSizes.control} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ flex: 1 }}>{o.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

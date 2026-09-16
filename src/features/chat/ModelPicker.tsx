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
import { Bot, BrainCircuit, Check, ChevronDown, Eye, Globe, Search, SlidersHorizontal, Wrench, X } from 'lucide-react';
import { useAiConfigStore, setActiveModel, type ModelProfile } from '@/lib/ai';
import { useAgentSettings } from '@features/agent/agentSettings';
import {
  CAPABILITY_LABELS, detectCapabilities, hasCapability,
  type ModelCapability,
} from '@features/agent/capabilities';
import { modelIcon, providerLabel } from '@features/agent/modelIcon';
import { useToastStore } from '@/components/Toast';

const CAP_ORDER: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

// ── 样式 ──

const pill: React.CSSProperties = {
  padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)',
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
        fontSize: 10, lineHeight: '14px', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
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
      title="思考强度"
    >
      <SlidersHorizontal size={12} style={{ color: 'var(--text-muted)' }} />
      <select
        data-testid={`think-level-${profile.id}`}
        value={eff.thinkingLevel}
        onChange={(e) =>
          agentSettings.updateModel(profile.id, { thinkingLevel: e.target.value as 'low' | 'medium' | 'high' })
        }
        style={{
          fontSize: 11, padding: '3px 6px', background: 'var(--canvas)',
          border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
      </select>
    </div>
  );
}

// ── 模型选择窗口 ──

export default function ModelPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 480, maxWidth: 'calc(100vw - 48px)', maxHeight: 'min(560px, 80vh)',
            display: 'flex', flexDirection: 'column',
            background: 'var(--elevated)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
            animation: 'modalIn 0.22s var(--ease-out)',
          }}
        >
        {/* 顶部：标题 + 搜索框 */}
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>选择模型</span>
            <button
              data-subtle
              title="关闭"
              onClick={onClose}
              style={{
                border: 'none', background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', padding: 2, display: 'inline-flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 10px', background: 'var(--canvas)' }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 12, color: 'var(--text-primary)',
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
                <TagIcon size={11} />
                {CAPABILITY_LABELS[cap]}
              </button>
            );
          })}
        </div>

        {/* 模型列表 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
          {list.length === 0 && (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
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
                onClick={() => {
                  void setActiveModel(m.id).then(() => {
                    toast(`已切换到 ${m.name || m.model}`);
                    onClose();
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: active ? 'var(--hover)' : 'transparent',
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
                  <Icon size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name || m.model}</span>
                    {active && <Check size={12} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 2 }}>
                      {providerLabel(m.provider)}
                    </span>
                    {CAP_ORDER.map((cap) => (
                      <CapBadge key={cap} on={caps[cap]} label={CAPABILITY_LABELS[cap]} />
                    ))}
                  </div>
                </div>
                <ItemControls profile={m} />
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
          padding: '5px 10px', fontSize: 12, border: '1px solid var(--border)',
          borderRadius: 8, background: 'var(--canvas)', color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        {cur?.provider && cur.model ? (() => {
          const Icon = modelIcon(cur.provider, cur.model);
          return <Icon size={13} style={{ color: 'var(--text-secondary)' }} />;
        })() : <Bot size={13} style={{ color: 'var(--text-muted)' }} />}
        {cur?.label ?? '全局默认'}
        <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
              minWidth: 200, background: 'var(--elevated)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: 'var(--shadow-md)', padding: '4px',
            }}
          >
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '6px 8px', fontSize: 12, textAlign: 'left',
                background: value === '' ? 'var(--hover)' : 'transparent',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                color: value === '' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Bot size={13} style={{ color: 'var(--text-muted)' }} />
              全局默认
              {value === '' && <Check size={12} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '6px 8px', fontSize: 12, textAlign: 'left',
                  background: o.value === value ? 'var(--hover)' : 'transparent',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                  color: o.value === value ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {o.provider && o.model ? (() => {
                  const Icon = modelIcon(o.provider, o.model);
                  return <Icon size={13} style={{ color: 'var(--text-secondary)' }} />;
                })() : <Bot size={13} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.value === value && <Check size={12} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

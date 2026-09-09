import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Eye,
  Globe,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore } from '@/components/ui/Toast/Toast';
import {
  CAPABILITY_LABELS,
  detectCapabilities,
  hasCapability,
  type ModelCapability,
} from '@/features/agent/capabilities';
import { modelIcon, providerLabel } from '@/features/agent/modelIcon';
import { useAgentSettings } from '@/features/agent/services/agentSettings';
import { type ModelProfile, setActiveModel, useAiConfigStore } from '@/services/tauri/ai';
import { cx } from '@/shared/utils/cx';
import s from './ModelPicker.module.css';

const CAP_ORDER: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

function CapBadge({ on, label }: { on: boolean; label: string }) {
  return <span className={cx(s.capBadge, on ? s.capBadgeOn : s.capBadgeOff)}>{label}</span>;
}

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
          agentSettings.updateModel(profile.id, {
            thinkingLevel: e.target.value as 'low' | 'medium' | 'high',
          })
        }
        style={{
          fontSize: 11,
          padding: '3px 6px',
          background: 'var(--canvas)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-primary)',
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
      if (q && !m.name.toLowerCase().includes(q) && !m.model.toLowerCase().includes(q))
        return false;
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
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div className={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>选择模型</span>
            <button
              data-subtle
              title="关闭"
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
          <div className={s.searchInner}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              className={s.searchInput}
            />
          </div>
        </div>
        <div className={s.capRow}>
          {CAP_ORDER.map((cap) => {
            const TagIcon =
              cap === 'vision'
                ? Eye
                : cap === 'reasoning'
                  ? BrainCircuit
                  : cap === 'tools'
                    ? Wrench
                    : Globe;
            return (
              <button
                key={cap}
                onClick={() => toggleTag(cap)}
                className={cx(s.capPill, tags.has(cap) && s.capPillOn)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <TagIcon size={11} />
                {CAPABILITY_LABELS[cap]}
              </button>
            );
          })}
        </div>
        <div className={s.list}>
          {list.length === 0 && <div className={s.empty}>无匹配模型</div>}
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
                className={cx(s.modelRow, active && s.modelRowSelected)}
              >
                <span
                  className={s.modelIcon}
                  style={{
                    background: active ? 'var(--hover)' : 'var(--block)',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <Icon size={15} />
                </span>
                <div className={s.modelInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={s.modelName}>{m.name || m.model}</span>
                    {active && <Check size={12} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <div className={s.modelMeta}>
                    <span style={{ marginRight: 2 }}>{providerLabel(m.provider)}</span>
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

export function ModelScopeBar({
  options,
  value,
  onChange,
}: {
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          fontSize: 12,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--canvas)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        {cur?.provider && cur.model ? (
          (() => {
            const Icon = modelIcon(cur.provider, cur.model);
            return <Icon size={13} style={{ color: 'var(--text-secondary)' }} />;
          })()
        ) : (
          <Bot size={13} style={{ color: 'var(--text-muted)' }} />
        )}
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
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 9999,
              minWidth: 200,
              background: 'var(--elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-md)',
              padding: '4px',
            }}
          >
            <ScopeOption
              value=""
              curValue={value}
              label="全局默认"
              icon={<Bot size={13} style={{ color: 'var(--text-muted)' }} />}
              onChange={(v) => {
                onChange(v);
                setOpen(false);
              }}
            />
            {options.map((o) => (
              <ScopeOption
                key={o.value}
                value={o.value}
                curValue={value}
                label={o.label}
                icon={
                  o.provider && o.model ? (
                    (() => {
                      const Icon = modelIcon(o.provider, o.model);
                      return <Icon size={13} style={{ color: 'var(--text-secondary)' }} />;
                    })()
                  ) : (
                    <Bot size={13} style={{ color: 'var(--text-muted)' }} />
                  )
                }
                onChange={(v) => {
                  onChange(v);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ScopeOption({
  value,
  curValue,
  label,
  icon,
  onChange,
}: {
  value: string;
  curValue: string;
  label: string;
  icon: React.ReactNode;
  onChange: (v: string) => void;
}) {
  return (
    <button
      onClick={() => onChange(value)}
      className={cx(s.modelRow)}
      style={{ color: value === curValue ? 'var(--text-primary)' : 'var(--text-secondary)' }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {value === curValue && <Check size={12} style={{ color: 'var(--accent)' }} />}
    </button>
  );
}

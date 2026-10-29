import { TextInput } from '@ui/fields/TextInput';
/**
 * Full model picker dialog: search by name or model id, filter by capability (vision, reasoning,
 * tools, search), then pick a row (icon, name, provider and capability badges). Each row can adjust
 * its thinking effort; selecting a row sets the model and closes the dialog.
 *
 * The same module exports ModelScopeBar for per-model settings scopes.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconSizes, Search, SlidersHorizontal, X } from '@ui/icons';
import { t } from '@i18n';
import { useAiConfigStore, setActiveModel, type ModelProfile, useAgentSettings } from '@features/agent';
import {
  detectCapabilities, hasCapability,
  type ModelCapability,
} from '@features/agent/model/capabilities';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { ModelCapabilityBadge } from '@features/agent/components/ModelCapabilityBadge';
import { ModelCapabilityToggle } from '@features/agent/components/ModelCapabilityToggle';
import { useToastStore } from '@ui/feedback/Toast';
import Select from '@ui/fields/Select';

const CAP_ORDER: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

/** Per-model quick setting: thinking effort (the AI panel already owns the agent switch). */
function ItemControls({ profile }: { profile: ModelProfile }) {
  const agentSettings = useAgentSettings();
  const eff = agentSettings.resolve(profile.id);
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);

  if (!caps.reasoning) return null;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
      onClick={(e) => e.stopPropagation()}
      data-tip={t('Thinking effort')}
    >
      <SlidersHorizontal size={iconSizes.compact} style={{ color: 'var(--text-muted)' }} />
      <Select<'low' | 'medium' | 'high'>
        aria-label={t('Thinking effort for {{model}}', { model: profile.name || profile.model })}
        value={eff.thinkingLevel}
        onChange={(thinkingLevel) =>
          agentSettings.updateModel(profile.id, { thinkingLevel })
        }
        options={[{ value: 'low', label: t('Low') }, { value: 'medium', label: t('Medium') }, { value: 'high', label: t('High') }]}
        style={{ width: 84 }}
      />
    </div>
  );
}

// Model picker dialog

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
        <div className="workspace-floating workspace-floating-dialog" role="dialog" aria-modal="true" aria-label={t('Select model')}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 480, maxWidth: 'calc(100vw - 48px)', maxHeight: 'min(560px, 80vh)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            animation: 'modalIn 0.22s var(--ease-out)',
          }}
        >
        {/* Header: title and search */}
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 'calc(14px * var(--ui-font-scale))', fontWeight: 'var(--fw-semibold)', flex: 1 }}>{t('Select model')}</span>
            <button
              data-subtle
              data-tip={t('Close')}
              aria-label={t('Close')}
              onClick={onClose}
              style={{
                border: 'none', background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', padding: 0, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={iconSizes.control} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 10px', background: 'var(--field-bg)' }}>
            <Search size={iconSizes.control} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <TextInput
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search models…')}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Capability filters */}
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 10px', flexWrap: 'wrap' }}>
          {CAP_ORDER.map(cap => <ModelCapabilityToggle key={cap} capability={cap}
            selected={tags.has(cap)} onChange={() => toggleTag(cap)} />)}
        </div>

        {/* Model list */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
          {list.length === 0 && (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-muted)' }}>
              {t('No matching models')}
            </div>
          )}
          {list.map((m) => {
            const Mark = modelMark(m.provider, m.model, m.baseUrl);
            const markHue = modelHue(m.provider, m.model, m.baseUrl);
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
                    toast(t('Switched to {{model}}', { model: m.name || m.model }));
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
                  <Mark size={iconSizes.row} style={{ color: markHue }} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', fontWeight: 'var(--fw-regular)', color: 'var(--text-primary)' }}>{m.name || m.model}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <span style={{ fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)', marginRight: 2 }}>
                      {providerLabel(m.provider)}
                    </span>
                    {CAP_ORDER.map((cap) => (
                      <ModelCapabilityBadge key={cap} supported={caps[cap]} capability={cap} />
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

// Model scope bar for per-model settings

export function ModelScopeBar({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      data-testid="model-scope-bar"
      aria-label={t('model.scope.aria')}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: t('model.scope.global') }, ...options]}
    />
  );
}

import { OutlineButton } from '@ui/OutlineButton';
/**
 * Provider credentials and configured models, in two panes: the provider rail on the left
 * (see ProviderRail) and the selected provider's key and model rows on the right. A provider
 * is an endpoint (API family plus effective base URL); the rail, selection and the row
 * filtering all derive from the model list itself (see providerList).
 */
import { useMemo, useRef, useState } from 'react';
import { IconButton } from '@ui/IconButton';
import ContextMenu from '@ui/ContextMenu';
import { Ellipsis, Plus, X } from '@ui/icons';
import { t } from '@i18n';
import {
  setProviderKey, clearProviderKey, setAiModels, setActiveModel, selectProvider, useAiConfigStore,
  type ModelProfile,
} from '@features/agent';
import type { ProviderKind } from '@features/agent/services/provider';
import { baseUrlForProvider } from '@features/agent/services/provider';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { modelIcon, providerLabel } from '@features/agent/components/modelIcon';
import Select from '@ui/Select';
import { useToastStore } from '@ui/Toast';
import { SettingsGroup, Field, ModelTextInput } from '@features/settings/components/ui';
import { applyModelPreset, type ModelPreset } from '@config/modelPresets';
import ModelThinkingSettings from '@features/settings/components/ModelThinkingSettings';
import ProviderPicker, { type ProviderPickerEntry } from '@features/settings/components/ProviderPicker';
import { providerHasKey, providerId, providerList, type ProviderRow } from '@features/settings/model/providerList';
import HarnessBadge from '../components/HarnessBadge';
import AutoSaveInput from '../components/AutoSaveInput';
import { useSettingsSave } from '../components/SettingsSaveProvider';

/** API families a model row can use, in the order the select offers them. */
const PROVIDER_KINDS: ProviderKind[] = ['openai-compatible', 'anthropic', 'gemini'];

const newModelId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

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

/** Capability chips (vision / reasoning / tools / search, as detected). */
function CapChips({ profile }: { profile: ModelProfile }) {
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {(
        [
          ['vision', t('Vision')],
          ['reasoning', t('Reasoning')],
          ['tools', t('Tools')],
          ['search', t('Search')],
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
  const { save } = useSettingsSave();
  const detailRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const toast = (msg: string, type: 'info' | 'success' | 'error') =>
    useToastStore.getState().addToast(msg, type);

  const models = aiCfg.models;
  const rows = useMemo(() => providerList(models), [models]);
  const selectedId = useMemo(() => {
    const wanted = aiCfg.selectedProvider ?? aiCfg.lastSelectedProvider;
    if (wanted && rows.some((row) => row.id === wanted)) return wanted;
    return rows[0]?.id ?? null;
  }, [rows, aiCfg.selectedProvider, aiCfg.lastSelectedProvider]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const entries: ProviderPickerEntry[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    hasKey: providerHasKey(row.kind, aiCfg),
  }));

  /** A preset adds its first model row and selects the vendor it belongs to. */
  const addPreset = (preset: ModelPreset) => {
    void save(async () => {
      let target = '';
      await commitModels((current) => {
        const next = applyModelPreset(current, preset, newModelId);
        target = next.id;
        return next.models;
      });
      if (target) await selectModel(target);
      selectProvider(providerId(preset.provider, preset.baseUrl));
    });
  };

  const setCurrentProvider = (rowId: string) => {
    const row = rows.find((entry) => entry.id === rowId);
    if (!row) return;
    selectProvider(rowId);
    const target = row.models.find((model) => model.id === aiCfg.activeModel) ?? row.models[0];
    if (target && target.id !== aiCfg.activeModel) void save(() => selectModel(target.id));
  };

  const editProviderKey = (rowId: string) => {
    selectProvider(rowId);
    requestAnimationFrame(() => {
      detailRef.current?.querySelector<HTMLInputElement>('input[type="password"]')?.focus();
    });
  };

  /** Deleting a provider removes its rows; the list never becomes empty. */
  const removeProvider = (rowId: string) => {
    const row = rows.find((entry) => entry.id === rowId);
    if (!row) return;
    if (models.length - row.models.length <= 0) {
      toast(t('Keep at least one model'), 'info');
      return;
    }
    const removed = new Set(row.models.map((model) => model.id));
    void save(() => commitModels((current) => current.filter((model) => !removed.has(model.id))));
    if (selectedId === rowId) selectProvider(null);
  };

  return (
    <div className="settings-provider-page">
      <ProviderPicker
        entries={entries}
        selectedId={selectedId}
        onSelect={selectProvider}
        onAddPreset={addPreset}
      />
      <div ref={detailRef} style={{ minWidth: 0 }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, minWidth: 0 }}>
              <HarnessBadge name={selected.name || providerLabel(selected.kind)} size={24} />
              <span style={{
                fontWeight: 'var(--fw-medium)', minWidth: 0, overflow: 'hidden',
                whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {selected.name || providerLabel(selected.kind)}
              </span>
              <span
                data-tip={selected.baseUrl}
                style={{
                  color: 'var(--text-muted)', fontSize: 'var(--fs-caption)', minWidth: 0,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}
              >
                {selected.baseUrl}
              </span>
              {/* Actions on the selected provider, then the read-only enable state. */}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <IconButton
                  compact
                  data-tip={t('More actions')}
                  aria-label={t('More actions')}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  <Ellipsis size={14} />
                </IconButton>
                <span data-tip={t('Enabled while this provider has models.')}>
                  <span
                    role="switch"
                    aria-checked="true"
                    aria-disabled="true"
                    aria-label={t('Enabled while this provider has models.')}
                    data-testid="provider-enabled"
                    style={{ width: 38, height: 22, borderRadius: 10, background: 'var(--accent)', position: 'relative', display: 'inline-block' }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: 19, width: 16, height: 16,
                      borderRadius: '50%', background: 'var(--accent-text)',
                    }} />
                  </span>
                </span>
              </span>
            </div>
            <ProviderCredentials row={selected} toast={toast} />
            <ProviderModels row={selected} toast={toast} />
          </>
        ) : (
          <div className="settings-provider-empty">{t('No providers yet.')}</div>
        )}
      </div>
      {menu && selected && (
        <ContextMenu
          anchor={menu}
          items={[
            { label: t('Set as current'), onClick: () => setCurrentProvider(selected.id) },
            { label: t('Edit key'), onClick: () => editProviderKey(selected.id) },
            { label: t('Delete provider'), danger: true, onClick: () => removeProvider(selected.id) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function ProviderCredentials({ row, toast }: {
  row: ProviderRow<ModelProfile>;
  toast: (msg: string, type: 'info' | 'success' | 'error') => void;
}) {
  const aiCfg = useAiConfigStore();
  const keySet = providerHasKey(row.kind, aiCfg);
  return (
    <SettingsGroup title={t('Provider credentials')}>
      <Field
        layout="stacked"
        title={t('Provider API Key')}
        description={t('Models from the current provider share one key, stored only on this device.')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4,
            color: keySet ? 'var(--success)' : 'var(--text-muted)',
            background: keySet ? 'var(--success-bg)' : 'var(--hover)',
          }}>
            {keySet ? t('Configured') : t('Not configured')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <AutoSaveInput
            key={row.kind}
            type="password"
            value=""
            placeholder={keySet ? t('Type to replace; leave empty to keep') : t('Enter API key')}
            onCommit={key => setProviderKey(row.kind, key)}
            clearAfterSave
            onClear={keySet ? async () => { await clearProviderKey(row.kind); toast(t('API key cleared'), 'success'); } : undefined}
            validate={key => key.trim() ? undefined : t('Type to replace; leave empty to keep')}
            style={{ flex: 1 }}
          />
        </div>
      </Field>
    </SettingsGroup>
  );
}

function ProviderModels({ row, toast }: {
  row: ProviderRow<ModelProfile>;
  toast: (msg: string, type: 'info' | 'success' | 'error') => void;
}) {
  const aiCfg = useAiConfigStore();
  const { save } = useSettingsSave();
  const models = aiCfg.models;
  const activeId = aiCfg.activeModel;

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
      toast(t('Keep at least one model'), 'info');
      return;
    }
    void save(() => commitModels(current => current.filter((m) => m.id !== id)));
  };

  const add = () => {
    void save(() => commitModels(
      current => [
        ...current,
        {
          id: newModelId(),
          name: t('Model {{index}}', { index: current.length + 1 }),
          provider: row.kind,
          baseUrl: row.baseUrl,
          model: '',
          capabilities: detectCapabilities(row.kind, ''),
        },
      ],
    ));
  };

  return (
    <SettingsGroup title={t('Available models')}>
      <Field
        layout="stacked"
        title={t('Model list')}
        description={t('Configure models and choose the active one. Models from the same provider share an API key.')}
      >
        <div className="settings-record-list">
          {row.models.map((m) => (
            <div
              key={m.id}
              className="settings-record"
            >
              <div className="settings-model-header">
                <span
                  data-tip={providerLabel(m.provider)}
                  style={{
                    width: 28, height: 32, borderRadius: 7, flexShrink: 0,
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
                  placeholder={t('Model name')}
                  onCommit={(v) => update(m.id, { name: v })}
                  style={{ flex: 1, fontWeight: 'var(--fw-medium)' }}
                />
                {m.id === activeId ? (
                  <span className="settings-model-active" style={{
                    fontSize: 'calc(11px * var(--ui-font-scale))', padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                    color: 'var(--success)', background: 'var(--success-bg)',
                  }}>
                    {t('Current')}
                  </span>
                ) : (
                  <OutlineButton data-subtle onClick={() => { void save(() => selectModel(m.id)); }}>
                    {t('Set as current')}
                  </OutlineButton>
                )}
                <IconButton tone="danger" onClick={() => remove(m.id)} data-tip={t('Delete model')} aria-label={t('Delete model')}><X size={16} /></IconButton>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <Select
                  aria-label={t('{{name}} provider', { name: m.name || t('Unnamed model') })}
                  options={PROVIDER_KINDS.map((kind) => ({ value: kind, label: providerLabel(kind) }))}
                  value={m.provider}
                  onChange={(v) => { void save(() => update(m.id, { provider: v, baseUrl: baseUrlForProvider(m.baseUrl, v) })); }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <ModelTextInput
                  value={m.baseUrl}
                  placeholder={t('Endpoint (base URL)')}
                  onCommit={(v) => update(m.id, { baseUrl: v })}
                  style={{ flex: 1 }}
                />
                <ModelTextInput
                  value={m.model}
                  placeholder={t('Model ID')}
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
          <OutlineButton
            data-subtle
            onClick={add}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
          >
            <Plus size={12} /> {t('Add model')}
          </OutlineButton>
        </div>
      </Field>
    </SettingsGroup>
  );
}

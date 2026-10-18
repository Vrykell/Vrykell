/**
 * Provider credentials and configured models, in two panes: the provider rail on the left
 * (see ProviderPicker) and the selected provider's key, endpoint and model list on the right.
 * A provider is an endpoint (API family plus effective base URL); the rail, selection and the
 * row filtering all derive from the model list itself (see providerList).
 */
import { useMemo, useRef, useState } from 'react';
import { IconButton } from '@ui/IconButton';
import ContextMenu from '@ui/ContextMenu';
import { Ellipsis } from '@ui/icons';
import { t } from '@i18n';
import { selectProvider, useAiConfigStore } from '@features/agent';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { useToastStore } from '@ui/Toast';
import { applyModelPreset, type ModelPreset } from '@config/modelPresets';
import ProviderPicker, { type ProviderPickerEntry } from '@features/settings/components/ProviderPicker';
import ProviderKeyCard from '@features/settings/components/ProviderKeyCard';
import ProviderEndpointCard from '@features/settings/components/ProviderEndpointCard';
import ProviderModelList from '@features/settings/components/ProviderModelList';
import { providerHasKey, providerId, providerList } from '@features/settings/model/providerList';
import { commitModels, newModelId, selectModel } from '@features/settings/model/modelWrites';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function AiModelPage() {
  const aiCfg = useAiConfigStore();
  const { save } = useSettingsSave();
  const detailRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** Bumped when the provider menu asks to edit the selected provider's key. */
  const [keyEditRequest, setKeyEditRequest] = useState(0);
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
  const SelectedMark = selected ? modelMark(selected.kind, '', selected.baseUrl) : null;
  const selectedHue = selected ? modelHue(selected.kind, '', selected.baseUrl) : '';

  const entries: ProviderPickerEntry[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    hasKey: providerHasKey(row.kind, aiCfg),
    baseUrl: row.baseUrl,
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
    setKeyEditRequest(value => value + 1);
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
              {SelectedMark && <SelectedMark size={22} aria-hidden="true" style={{ color: selectedHue }} />}
              <span style={{
                fontWeight: 'var(--fw-medium)', minWidth: 0, overflow: 'hidden',
                whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {selected.name || providerLabel(selected.kind)}
              </span>
              {/* Actions on the selected provider. */}
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
              </span>
            </div>
            <ProviderKeyCard row={selected} toast={toast} keyEditRequest={keyEditRequest} />
            <ProviderEndpointCard row={selected} />
            <ProviderModelList row={selected} toast={toast} />
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

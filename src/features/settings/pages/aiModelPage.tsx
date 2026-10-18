/**
 * Provider credentials and configured models, in one column: the provider dropdown in the header
 * picks the endpoint the page shows (and carries the add-provider entry), the ··· menu acts on
 * the selected provider, and the key, endpoint and model blocks below edit it. A provider is an
 * endpoint (API family plus effective base URL); the dropdown, the selection and the row
 * filtering all derive from the model list itself (see providerList).
 */
import { useMemo, useRef, useState } from 'react';
import { IconButton } from '@ui/IconButton';
import ContextMenu from '@ui/ContextMenu';
import ConfirmDialog from '@ui/ConfirmDialog';
import Select from '@ui/Select';
import { Ellipsis } from '@ui/icons';
import { t } from '@i18n';
import { selectProvider, useAiConfigStore, type ModelProfile } from '@features/agent';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { useToastStore } from '@ui/Toast';
import { applyModelPreset, type ModelPreset } from '@config/modelPresets';
import AddProviderDialog from '@features/settings/components/AddProviderDialog';
import ProviderKeyCard from '@features/settings/components/ProviderKeyCard';
import ProviderEndpointCard from '@features/settings/components/ProviderEndpointCard';
import ProviderModelList from '@features/settings/components/ProviderModelList';
import { providerHasKey, providerId, providerList, type ProviderRow } from '@features/settings/model/providerList';
import { commitModels, newModelId, selectModel } from '@features/settings/model/modelWrites';
import { useSettingsSave } from '../components/SettingsSaveProvider';

export function AiModelPage() {
  const aiCfg = useAiConfigStore();
  const { save } = useSettingsSave();
  const detailRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmProvider, setConfirmProvider] = useState<ProviderRow<ModelProfile> | null>(null);
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

  const options = rows.map((row) => {
    const Mark = modelMark(row.kind, '', row.baseUrl);
    return {
      value: row.id,
      label: row.name || providerLabel(row.kind),
      icon: (
        <span style={{ display: 'inline-flex', color: modelHue(row.kind, '', row.baseUrl) }}>
          <Mark size={14} aria-hidden="true" />
        </span>
      ),
      badge: (
        <span
          className="provider-key-dot"
          data-empty={providerHasKey(row.kind, aiCfg) ? undefined : 'true'}
          aria-hidden="true"
        />
      ),
    };
  });

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
    if (!providerHasKey(preset.provider, aiCfg)) {
      toast(t('{{name}} added. Configure its API key before sending.', { name: preset.name }), 'info');
    }
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

  /** Deleting a provider removes its rows, so it asks first; the list never becomes empty. */
  const requestRemoveProvider = (rowId: string) => {
    const row = rows.find((entry) => entry.id === rowId);
    if (!row) return;
    if (models.length - row.models.length <= 0) {
      toast(t('Keep at least one model'), 'info');
      return;
    }
    setConfirmProvider(row);
  };
  const removeProviderConfirmed = () => {
    const row = confirmProvider;
    setConfirmProvider(null);
    if (!row) return;
    const removed = new Set(row.models.map((model) => model.id));
    void save(() => commitModels((current) => current.filter((model) => !removed.has(model.id))));
    if (selectedId === row.id) selectProvider(null);
  };

  return (
    <div className="settings-provider-page">
      <div ref={detailRef} style={{ minWidth: 0 }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, minWidth: 0 }}>
              <Select
                value={selected.id}
                options={options}
                onChange={(id) => selectProvider(id)}
                aria-label={t('Provider')}
                data-testid="provider-select"
                triggerClassName="provider-select-trigger"
                style={{ maxWidth: 380 }}
                action={{ label: t('Add provider'), onSelect: () => setAddOpen(true) }}
              />
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
            { label: t('Delete provider'), danger: true, onClick: () => requestRemoveProvider(selected.id) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      <AddProviderDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAddPreset={addPreset}
      />
      <ConfirmDialog
        open={confirmProvider !== null}
        title={t('Delete provider')}
        message={confirmProvider
          ? t('Remove {{name}} and its {{count}} models?', {
            name: confirmProvider.name || providerLabel(confirmProvider.kind),
            count: confirmProvider.models.length,
          })
          : ''}
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
        danger
        onConfirm={removeProviderConfirmed}
        onCancel={() => setConfirmProvider(null)}
      />
    </div>
  );
}

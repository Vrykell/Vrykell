/**
 * ProviderDialog — the centred menu behind the provider button, shaped like the model picker.
 *
 * It keeps both steps in one surface: the provider rows (a grey surface, a mark tile, the name
 * and a meta line with the API family and the key status; the shown provider is lifted further
 * and carries a check) and, one view deeper, the preset grid behind the add-provider row.
 * Switching views never stacks a second dialog, so closing always returns to the page.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import { Check, Plus, iconSizes } from '@ui/icons';
import { MODEL_PRESETS, type ModelPreset } from '@config/modelPresets';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import type { ModelProfile } from '@features/agent';
import SettingsDialog from './SettingsDialog';
import CustomProviderFields, { type CustomProviderDraft } from './CustomProviderFields';

const metaStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, marginTop: 3,
  fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)',
};

const nameStyle: CSSProperties = {
  display: 'block', fontSize: 'calc(12px * var(--ui-font-scale))',
  fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

export default function ProviderDialog({ open, rows, selectedId, flags, onSelect, onAddPreset, onAddCustom, onClose }: {
  open: boolean;
  rows: ProviderRow<ModelProfile>[];
  selectedId: string | null;
  flags: { providerKeys: string[] };
  onSelect: (id: string) => void;
  onAddPreset: (preset: ModelPreset) => void;
  onAddCustom?: (draft: CustomProviderDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [view, setView] = useState<'list' | 'presets' | 'custom'>('list');

  useEffect(() => {
    if (open) setView('list');
  }, [open]);

  return (
    <SettingsDialog
      open={open}
      testId="provider-dialog"
      title={view === 'list' ? t('Provider') : t('Add provider')}
      width={480}
      onBack={view !== 'list' ? () => setView(view === 'custom' ? 'presets' : 'list') : undefined}
      onClose={onClose}
    >
      {view === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((row) => {
            const Mark = modelMark(row.kind, '', row.baseUrl);
            const selected = row.id === selectedId;
            const hasKey = providerHasKey(row.id, flags);
            return (
              <button
                key={row.id}
                type="button"
                className="provider-option-row"
                data-testid={`provider-option-${row.id}`}
                data-selected={selected}
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onSelect(row.id);
                  onClose();
                }}
              >
                <span className="provider-option-mark">
                  <Mark size={iconSizes.row} style={{ color: modelHue(row.kind, '', row.baseUrl) }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={nameStyle}>{row.name || providerLabel(row.kind)}</span>
                  <span style={metaStyle}>
                    {providerLabel(row.kind)}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '1px 6px', borderRadius: 4,
                      background: hasKey ? 'var(--hover)' : 'transparent',
                      border: hasKey ? 'none' : '1px solid var(--border)',
                    }}>
                      <span className="provider-key-dot" data-empty={hasKey ? undefined : 'true'} aria-hidden="true" />
                      {hasKey ? t('Configured') : t('Not configured')}
                    </span>
                  </span>
                </span>
                {selected && <Check size={iconSizes.compact} style={{ color: 'var(--text-primary)', flexShrink: 0 }} />}
              </button>
            );
          })}
          <button
            type="button"
            className="provider-option-row provider-option-add"
            data-testid="provider-dialog-add"
            onClick={() => setView('presets')}
          >
            <span className="provider-option-mark"><Plus size={iconSizes.compact} /></span>
            <span className="provider-option-name">{t('Add provider')}</span>
          </button>
        </div>
      ) : view === 'custom' && onAddCustom ? <CustomProviderFields onAdd={async draft => { await onAddCustom(draft); onClose(); }} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
            {onAddCustom && <button type="button" className="settings-preset-cell" data-testid="provider-custom" onClick={() => setView('custom')}><Plus size={15} /><span>{t('Custom provider')}</span></button>}
            {MODEL_PRESETS.map((preset) => {
              const Mark = modelMark(preset.provider, preset.model, preset.baseUrl);
              return (
                <button
                  key={preset.name}
                  type="button"
                  className="settings-preset-cell"
                  data-testid={`model-preset-${preset.name}`}
                  data-tip={preset.baseUrl || t('The vendor default endpoint')}
                  data-tip-description={`${preset.model} · ${t(preset.hint)}`}
                  onClick={() => {
                    onAddPreset(preset);
                    setView('list');
                  }}
                >
                  <Mark size={15} aria-hidden="true" />
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
            {t('Vendor names, endpoints and marks identify the services they name so a model can be filled in quickly; the app ships no third-party program or key.')}
          </span>
        </>
      )}
    </SettingsDialog>
  );
}

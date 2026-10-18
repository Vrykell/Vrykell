/**
 * ProviderDialog — the centred menu behind the provider button, shaped like the model picker.
 *
 * It keeps both steps in one surface: the provider rows (a mark tile, the name and a meta line
 * with the API family and the key dot, the shown provider lifted) and, one view deeper, the
 * preset grid behind the add-provider row. Switching views never stacks a second dialog, so
 * closing always returns to the page rather than leaving an empty shell behind.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { Check, Plus, iconSizes } from '@ui/icons';
import { MODEL_PRESETS, type ModelPreset } from '@config/modelPresets';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import type { ModelProfile } from '@features/agent';
import SettingsDialog from './SettingsDialog';

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, textAlign: 'left',
};

const metaStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, marginTop: 3,
  fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)',
};

const tileStyle: CSSProperties = {
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

export default function ProviderDialog({ open, rows, selectedId, flags, onSelect, onAddPreset, onClose }: {
  open: boolean;
  rows: ProviderRow<ModelProfile>[];
  selectedId: string | null;
  flags: { providerKeys: string[] };
  onSelect: (id: string) => void;
  onAddPreset: (preset: ModelPreset) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'list' | 'presets'>('list');

  useEffect(() => {
    if (open) setView('list');
  }, [open]);

  return (
    <SettingsDialog
      open={open}
      testId="provider-dialog"
      title={view === 'list' ? t('Provider') : t('Add provider')}
      width={480}
      onBack={view === 'presets' ? () => setView('list') : undefined}
      onClose={onClose}
      footer={<OutlineButton onClick={onClose} data-testid="provider-dialog-close">{t('Close')}</OutlineButton>}
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
                className="workspace-floating-row"
                data-testid={`provider-option-${row.id}`}
                data-selected={selected}
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onSelect(row.id);
                  onClose();
                }}
                style={rowStyle}
              >
                <span style={{
                  ...tileStyle,
                  background: selected ? 'var(--hover)' : 'var(--block)',
                  color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
                }}>
                  <Mark size={iconSizes.row} style={{ color: modelHue(row.kind, '', row.baseUrl) }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 'calc(12px * var(--ui-font-scale))',
                    fontWeight: 'var(--fw-semibold)', color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {row.name || providerLabel(row.kind)}
                  </span>
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
            className="workspace-floating-row"
            data-testid="provider-dialog-add"
            onClick={() => setView('presets')}
            style={rowStyle}
          >
            <span style={{ ...tileStyle, background: 'var(--block)', color: 'var(--text-muted)' }}>
              <Plus size={iconSizes.compact} />
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>
              {t('Add provider')}
            </span>
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
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

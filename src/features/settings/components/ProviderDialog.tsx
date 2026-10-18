/**
 * ProviderDialog — the centred menu behind the provider button, shaped like the model picker:
 * one row per provider with a mark tile, the name and a meta line (the API family plus the key
 * status), the shown provider lifted, and an add-provider row of the same shape at its end.
 */
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { Check, Plus, iconSizes } from '@ui/icons';
import type { CSSProperties } from 'react';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import type { ModelProfile } from '@features/agent';
import SettingsDialog from './SettingsDialog';

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '9px 10px', border: 0, borderRadius: 8, background: 'transparent',
  cursor: 'pointer', marginBottom: 2, textAlign: 'left',
};

const metaStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, marginTop: 3,
  fontSize: 'calc(10px * var(--ui-font-scale))', color: 'var(--text-muted)',
};

export default function ProviderDialog({ open, rows, selectedId, flags, onSelect, onAddProvider, onClose }: {
  open: boolean;
  rows: ProviderRow<ModelProfile>[];
  selectedId: string | null;
  flags: { providerKeys: string[] };
  onSelect: (id: string) => void;
  onAddProvider: () => void;
  onClose: () => void;
}) {
  return (
    <SettingsDialog
      open={open}
      testId="provider-dialog"
      title={t('Provider')}
      width={480}
      onClose={onClose}
      footer={<OutlineButton onClick={onClose} data-testid="provider-dialog-close">{t('Close')}</OutlineButton>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row) => {
          const Mark = modelMark(row.kind, '', row.baseUrl);
          const selected = row.id === selectedId;
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
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
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
                  <span className="provider-key-dot" data-empty={providerHasKey(row.id, flags) ? undefined : 'true'} aria-hidden="true" />
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
          onClick={() => {
            onClose();
            onAddProvider();
          }}
          style={rowStyle}
        >
          <span style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--block)', color: 'var(--text-muted)',
          }}>
            <Plus size={iconSizes.compact} />
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--text-secondary)' }}>
            {t('Add provider')}
          </span>
        </button>
      </div>
    </SettingsDialog>
  );
}

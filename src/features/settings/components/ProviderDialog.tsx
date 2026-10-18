/**
 * ProviderDialog — the centred menu behind the provider button.
 *
 * One row per provider (a neutral tile with the brand mark, the name, the key dot and a check on
 * the one the page shows) and an add-provider row of the same shape at its end, so switching and
 * adding live in one place instead of a form control on the page.
 */
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { Check, Plus } from '@ui/icons';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { providerHasKey, type ProviderRow } from '@features/settings/model/providerList';
import type { ModelProfile } from '@features/agent';
import SettingsDialog from './SettingsDialog';

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
      width={460}
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
              className="provider-option-row"
              data-testid={`provider-option-${row.id}`}
              aria-current={selected ? 'true' : undefined}
              onClick={() => {
                onSelect(row.id);
                onClose();
              }}
            >
              <span className="provider-option-mark" style={{ color: modelHue(row.kind, '', row.baseUrl) }}>
                <Mark size={18} aria-hidden="true" />
              </span>
              <span className="provider-option-name">{row.name || providerLabel(row.kind)}</span>
              <span
                className="provider-key-dot"
                data-empty={providerHasKey(row.id, flags) ? undefined : 'true'}
                aria-hidden="true"
              />
              {selected && <Check size={14} aria-hidden="true" style={{ color: 'var(--text-primary)' }} />}
            </button>
          );
        })}
        <button
          type="button"
          className="provider-option-row provider-option-add"
          data-testid="provider-dialog-add"
          onClick={() => {
            onClose();
            onAddProvider();
          }}
        >
          <span className="provider-option-mark"><Plus size={14} aria-hidden="true" /></span>
          <span className="provider-option-name">{t('Add provider')}</span>
        </button>
      </div>
    </SettingsDialog>
  );
}

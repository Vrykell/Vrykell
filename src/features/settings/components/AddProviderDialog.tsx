/**
 * AddProviderDialog — the centred panel behind "+ Add provider".
 *
 * One cell per preset; picking one adds its model row and selects the provider it belongs to.
 * The panel is the same overlay every other settings editor uses, so it opens centred, traps
 * focus and closes on Escape or a backdrop click.
 */
import { t } from '@i18n';
import { OutlineButton } from '@ui/OutlineButton';
import { MODEL_PRESETS, type ModelPreset } from '@config/modelPresets';
import { modelMark } from '@features/agent/components/modelIcon';
import SettingsDialog from './SettingsDialog';

export default function AddProviderDialog({ open, onClose, onAddPreset }: {
  open: boolean;
  onClose: () => void;
  onAddPreset: (preset: ModelPreset) => void;
}) {
  return (
    <SettingsDialog
      open={open}
      testId="add-provider-dialog"
      title={t('Add provider')}
      width={560}
      onClose={onClose}
      footer={<OutlineButton onClick={onClose} data-testid="add-provider-close">{t('Close')}</OutlineButton>}
    >
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
                onClose();
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
    </SettingsDialog>
  );
}

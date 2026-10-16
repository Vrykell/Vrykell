/**
 * ProviderPicker — the model page's provider bar.
 *
 * One chip per provider the model list is made of (see providerList): a brand-tinted tile with
 * the first letter, the provider's name and a key dot. The bar wraps at narrow widths instead
 * of taking a column of its own, which is what the width here allows. The presets behind
 * "+ Add provider" are how a provider gets added; actions on the selected provider (set as
 * current / edit key / delete) live on the page header, so this component only renders and
 * reports.
 */
import { useState } from 'react';
import { t } from '@i18n';
import { MODEL_PRESETS, type ModelPreset } from '@config/modelPresets';
import { Plus } from '@ui/icons';
import type { ProviderKind } from '@features/agent/services/provider';
import { modelHue, modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { OutlineButton } from '@ui/OutlineButton';

export interface ProviderPickerEntry {
  id: string;
  kind: ProviderKind;
  /** Preset name or endpoint host; '' falls back to the family label. */
  name: string;
  hasKey: boolean;
  /** Effective base URL of the provider; decides the vendor mark. */
  baseUrl: string;
}

interface Props {
  entries: ProviderPickerEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddPreset: (preset: ModelPreset) => void;
}

export default function ProviderPicker({ entries, selectedId, onSelect, onAddPreset }: Props) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  return (
    <div className="settings-provider-bar-wrap">
      <div className="settings-provider-bar" role="group" aria-label={t('Provider')}>
        {entries.map((entry) => {
          const label = entry.name || providerLabel(entry.kind);
          const Mark = modelMark(entry.kind, '', entry.baseUrl);
          const hue = modelHue(entry.kind, '', entry.baseUrl);
          return (
            <button
              key={entry.id}
              type="button"
              className="settings-provider-chip"
              data-provider-id={entry.id}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              data-tip={label}
              onClick={() => onSelect(entry.id)}
            >
              <Mark size={16} aria-hidden="true" style={{ color: hue }} />
              <span className="settings-provider-name">{label}</span>
              <span className="settings-provider-dot" data-empty={entry.hasKey ? undefined : 'true'} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <OutlineButton
        data-subtle
        data-testid="provider-add"
        onClick={() => setPresetsOpen((open) => !open)}
        style={{ flexShrink: 0 }}
      >
        <Plus size={12} /> {t('Add provider')}
      </OutlineButton>
      {presetsOpen && (
        <div data-testid="model-presets" className="settings-provider-presets">
          {MODEL_PRESETS.map((preset) => {
            const Mark = modelMark(preset.provider, preset.model, preset.baseUrl);
            const hue = modelHue(preset.provider, preset.model, preset.baseUrl);
            return (
              <OutlineButton
                key={preset.name}
                data-subtle
                data-testid={`model-preset-${preset.name}`}
                data-tip={preset.baseUrl || t('The vendor default endpoint')}
                data-tip-description={`${preset.model} · ${t(preset.hint)}`}
                onClick={() => onAddPreset(preset)}
              >
                <Mark size={13} aria-hidden="true" style={{ color: hue }} /> {preset.name}
              </OutlineButton>
            );
          })}
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
            {t('Vendor names, endpoints and marks are listed as references so a model can be filled in quickly; the marks are drawn locally and the app ships no third-party program or key.')}
          </span>
        </div>
      )}
    </div>
  );
}

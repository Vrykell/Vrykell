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
import { providerLabel } from '@features/agent/components/modelIcon';
import { OutlineButton } from '@ui/OutlineButton';
import HarnessBadge from './HarnessBadge';

export interface ProviderPickerEntry {
  id: string;
  kind: ProviderKind;
  /** Preset name or endpoint host; '' falls back to the family label. */
  name: string;
  hasKey: boolean;
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
              <HarnessBadge name={label} size={18} />
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
          {MODEL_PRESETS.map((preset) => (
            <OutlineButton
              key={preset.name}
              data-subtle
              data-testid={`model-preset-${preset.name}`}
              data-tip={preset.baseUrl || t('The vendor default endpoint')}
              data-tip-description={`${preset.model} · ${t(preset.hint)}`}
              onClick={() => onAddPreset(preset)}
            >
              {preset.name}
            </OutlineButton>
          ))}
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
            {t('Vendor names and endpoints are listed as data so a model can be filled in quickly; the app ships no third-party program, key or brand asset.')}
          </span>
        </div>
      )}
    </div>
  );
}

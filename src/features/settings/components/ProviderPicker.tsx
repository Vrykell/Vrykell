/**
 * ProviderPicker — the model page's provider bar.
 *
 * One cell per provider the model list is made of (see providerList): a brand mark, the
 * provider's name and a key dot, laid out on an even grid so a wrapped row never leaves a ragged
 * gap. The presets behind "+ Add provider" open in a centred panel; actions on the selected
 * provider (set as current / edit key / delete) live on the page header, so this component only
 * renders and reports.
 */
import { useState } from 'react';
import { t } from '@i18n';
import type { ModelPreset } from '@config/modelPresets';
import { Plus } from '@ui/icons';
import type { ProviderKind } from '@features/agent/services/provider';
import { modelMark, providerLabel } from '@features/agent/components/modelIcon';
import { OutlineButton } from '@ui/OutlineButton';
import AddProviderDialog from './AddProviderDialog';

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
              <Mark size={16} aria-hidden="true" />
              <span className="settings-provider-name">{label}</span>
              <span className="settings-provider-dot" data-empty={entry.hasKey ? undefined : 'true'} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <OutlineButton
        data-subtle
        data-testid="provider-add"
        onClick={() => setPresetsOpen(true)}
        style={{ flexShrink: 0 }}
      >
        <Plus size={12} /> {t('Add provider')}
      </OutlineButton>
      <AddProviderDialog
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        onAddPreset={onAddPreset}
      />
    </div>
  );
}

/**
 * ProviderRail — the model page's provider column.
 *
 * A row is one provider the model list is made of (see providerList): a brand-tinted tile with
 * its initial, the provider's name and a dot that marks a configured key of its API family. The
 * hover menu reports its actions to the owning page, which owns the store access; this component
 * only renders and reports. The presets at the bottom are how a provider gets added.
 */
import { useState } from 'react';
import { t } from '@i18n';
import { MODEL_PRESETS, type ModelPreset } from '@config/modelPresets';
import { IconButton } from '@ui/IconButton';
import { TextInput } from '@ui/TextInput';
import { iconSizes, Ellipsis, Plus, Search } from '@ui/icons';
import ContextMenu, { type ContextMenuItem } from '@ui/ContextMenu';
import type { ProviderKind } from '@features/agent/services/provider';
import { providerLabel } from '@features/agent/components/modelIcon';
import { btnStyle } from './formStyles';
import HarnessBadge from './HarnessBadge';

export interface ProviderRailEntry {
  id: string;
  kind: ProviderKind;
  /** Preset name or endpoint host; '' falls back to the family label. */
  name: string;
  hasKey: boolean;
}

interface Props {
  entries: ProviderRailEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSetCurrent: (id: string) => void;
  onEditKey: (id: string) => void;
  onDelete: (id: string) => void;
  onAddPreset: (preset: ModelPreset) => void;
}

export default function ProviderRail({
  entries, selectedId, onSelect, onSetCurrent, onEditKey, onDelete, onAddPreset,
}: Props) {
  const [query, setQuery] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ProviderRailEntry } | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? entries.filter((entry) =>
        `${entry.name || providerLabel(entry.kind)} ${providerLabel(entry.kind)}`.toLowerCase().includes(needle))
    : entries;

  const menuItems = (entry: ProviderRailEntry): ContextMenuItem[] => [
    { label: t('Set as current'), onClick: () => onSetCurrent(entry.id) },
    { label: t('Edit key'), onClick: () => onEditKey(entry.id) },
    { label: t('Delete provider'), danger: true, onClick: () => onDelete(entry.id) },
  ];

  return (
    <div className="settings-provider-rail">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
        borderRadius: 'var(--radius-inner)', background: 'var(--field-bg)',
      }}>
        <Search size={iconSizes.compact} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}
          placeholder={t('Search providers…')}
          aria-label={t('Search providers…')}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none',
            outline: 'none', fontSize: 'var(--fs-label)', color: 'var(--text-primary)',
          }}
        />
      </div>

      <div className="settings-provider-list">
        {visible.map((entry) => {
          const label = entry.name || providerLabel(entry.kind);
          return (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              className="settings-provider-row"
              data-provider-id={entry.id}
              aria-label={label}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(entry.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(entry.id);
                }
              }}
            >
              <HarnessBadge name={label} size={26} />
              <span className="settings-provider-name" data-tip={label}>{label}</span>
              <span className="settings-provider-tail">
                <span className="settings-provider-dot" data-empty={entry.hasKey ? undefined : 'true'} aria-hidden="true" />
                <span className="settings-provider-kebab">
                  <IconButton
                    compact
                    data-tip={t('More actions')}
                    aria-label={t('More actions')}
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ x: rect.left, y: rect.bottom + 4, entry });
                    }}
                  >
                    <Ellipsis size={14} />
                  </IconButton>
                </span>
              </span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="settings-provider-empty">
            {entries.length ? t('No matching providers') : t('No providers yet.')}
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          data-subtle
          data-testid="provider-add"
          onClick={() => setPresetsOpen((open) => !open)}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={12} /> {t('Add provider')}
        </button>
        {presetsOpen && (
          <div data-testid="model-presets" className="settings-provider-presets" style={{ marginTop: 8 }}>
            {MODEL_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                style={btnStyle}
                data-testid={`model-preset-${preset.name}`}
                data-tip={preset.baseUrl || t('The vendor default endpoint')}
                data-tip-description={`${preset.model} · ${t(preset.hint)}`}
                onClick={() => onAddPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
              {t('Vendor names and endpoints are listed as data so a model can be filled in quickly; the app ships no third-party program, key or brand asset.')}
            </span>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu anchor={{ x: menu.x, y: menu.y }} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

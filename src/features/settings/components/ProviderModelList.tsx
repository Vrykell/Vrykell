/**
 * ProviderModelList — one provider's models: a searchable, vendor-grouped list with the sync
 * action that pulls the endpoint's own model list, and a centred editor behind each row's gear.
 *
 * The list closes its own loops: adding a model asks for its identifier before the row exists,
 * a model without one cannot be set as current, and deleting a row asks first because its
 * overrides cannot be recovered.
 */
import { useMemo, useState } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import ReloadButton from '@ui/actions/ReloadButton';
import { TextInput } from '@ui/fields/TextInput';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { ChevronDown, Filter, Minus, Plus, Search, Settings, X, iconSizes } from '@ui/icons';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { modelHue, modelMark } from '@features/agent/components/modelIcon';
import { ModelCapabilityBadge } from '@features/agent/components/ModelCapabilityBadge';
import { providerFetchModels, useAiConfigStore, type ModelProfile } from '@features/agent';
import { commitModels } from '@features/settings/model/modelWrites';
import { filterModels, groupModelsByVendor } from '@features/settings/model/modelGroups';
import type { ProviderRow } from '@features/settings/model/providerList';
import { SettingsGroup, Field } from './ui';
import AddModelDialog from './AddModelDialog';
import ModelSettingsDialog from './ModelSettingsDialog';
import { useSettingsSave } from './SettingsSaveProvider';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

/** The filter chips, in the order they appear. */
const FILTERS: (ModelCapability | 'all')[] = ['all', 'vision', 'reasoning', 'tools', 'search'];

const CAPABILITIES: [ModelCapability, string][] = [
  ['vision', t('Vision')],
  ['reasoning', t('Reasoning')],
  ['tools', t('Tools')],
  ['search', t('Search')],
];

function CapabilityChips({ profile }: { profile: ModelProfile }) {
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0, color: 'var(--text-muted)' }}>
      {CAPABILITIES.map(([cap]) => <ModelCapabilityBadge key={cap} capability={cap} supported={caps[cap]} />)}
    </div>
  );
}

function ModelRow({ model, active, onRemove }: {
  model: ModelProfile;
  active: boolean;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const Mark = modelMark(model.provider, model.model, model.baseUrl);
  return (
    <div data-testid="model-row" data-active={active || undefined} style={{ padding: '6px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{
          width: 28, height: 28, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', color: modelHue(model.provider, model.model, model.baseUrl),
        }}>
          <Mark size={20} aria-hidden="true" />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span data-testid="model-name" style={{
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: 'var(--fw-regular)',
          }}>
            {model.name || model.model || t('Unnamed model')}
          </span>
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <CapabilityChips profile={model} />
          <IconButton data-testid="model-settings" aria-expanded={editing}
            aria-label={t('Model settings')} data-tip={t('Model settings')} onClick={() => setEditing(true)}>
            <Settings size={iconSizes.control} />
          </IconButton>
          <IconButton tone="danger" data-testid="model-remove"
            aria-label={t('Delete model')} data-tip={t('Delete model')} onClick={onRemove}>
            <Minus size={iconSizes.control} />
          </IconButton>
        </div>
      </div>
      <ModelSettingsDialog open={editing} model={model} onClose={() => setEditing(false)} />
    </div>
  );
}

export default function ProviderModelList({ row, toast }: {
  row: ProviderRow<ModelProfile>;
  toast: Toast;
}) {
  const aiCfg = useAiConfigStore();
  const { save } = useSettingsSave();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [capability, setCapability] = useState<ModelCapability | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ModelProfile | null>(null);

  const models = row.models;
  const activeId = aiCfg.activeModel;
  const visible = useMemo(() => filterModels(models, query, capability), [models, query, capability]);
  const groups = useMemo(() => groupModelsByVendor(visible), [visible]);
  const allCollapsed = groups.length > 0 && groups.every(group => collapsed.has(group.key));

  const toggleGroup = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(group => group.key)));

  const requestRemove = (model: ModelProfile) => {
    if (models.length <= 1) {
      toast(t('Keep at least one model'), 'info');
      return;
    }
    setConfirmRemove(model);
  };
  const removeConfirmed = () => {
    const target = confirmRemove;
    setConfirmRemove(null);
    if (target) void save(() => commitModels(current => current.filter(model => model.id !== target.id)));
  };

  /** Pull the endpoint's own list and add the ids the list does not have yet. */
  const sync = async () => {
    setSyncing(true);
    try {
      const ids = await providerFetchModels(row.id, row.kind, row.baseUrl);
      const known = new Set(models.map(model => model.model));
      const missing = ids.filter(id => id && !known.has(id));
      if (missing.length === 0) {
        toast(t('No new models on this endpoint.'), 'info');
        return;
      }
      await save(() => commitModels(current => [
        ...current,
        ...missing.map(id => ({
          id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
          name: id, provider: row.kind, baseUrl: row.baseUrl, model: id,
          providerName: row.models.find(model => model.providerName)?.providerName,
          capabilities: detectCapabilities(row.kind, id),
        })),
      ]));
      toast(t('Added {{count}} models.', { count: missing.length }), 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SettingsGroup title={t('Available models')}>
      <Field
        layout="stacked"
        title={t('Model list')}
        description={t('Configure models and choose the active one. Models from the same provider share an API key.')}
      >
        <div className="settings-model-list-toolbar" data-testid="model-list-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <IconButton data-testid="model-collapse-all" disabled={models.length === 0}
            aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')}
            data-tip={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={toggleAll}>
            <ChevronDown size={iconSizes.control} style={{ transform: allCollapsed ? undefined : 'rotate(180deg)', transition: 'transform 0.12s var(--ease)' }} />
          </IconButton>
          <IconButton data-testid="model-search-toggle" aria-expanded={searchOpen}
            aria-label={t('Search models')} data-tip={t('Search models')}
            onClick={() => { setSearchOpen(value => !value); if (searchOpen) setQuery(''); }}>
            <Search size={iconSizes.control} />
          </IconButton>
          <IconButton data-testid="model-filter-toggle" aria-expanded={filterOpen}
            aria-label={t('Filter models')} data-tip={t('Filter models')} onClick={() => setFilterOpen(value => !value)}>
            <Filter size={iconSizes.control} />
          </IconButton>
          <span style={{ flex: 1 }} />
          <ReloadButton testId="model-sync" busy={syncing} label={t('Sync models')} onReload={sync} />
          <IconButton data-testid="model-add" aria-label={t('Add model')} data-tip={t('Add model')} onClick={() => setAddOpen(true)}>
            <Plus size={iconSizes.control} />
          </IconButton>
        </div>
        {searchOpen && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '0 8px', minHeight: 32,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)', background: 'var(--field-bg)',
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <TextInput autoFocus value={query} data-testid="model-search" onChange={event => setQuery(event.target.value)}
              placeholder={t('Search models…')}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)',
                fontFamily: 'var(--font-ui)', fontSize: 'calc(12px * var(--ui-font-scale))',
              }} />
            {query && (
              <button type="button" data-subtle data-testid="model-search-clear" aria-label={t('Clear search')}
                onClick={() => setQuery('')}
                style={{ display: 'inline-flex', border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={11} />
              </button>
            )}
          </div>
        )}
        {filterOpen && (
          <div data-testid="model-filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {FILTERS.map((cap) => {
              const label = cap === 'all' ? t('All') : CAPABILITIES.find(([value]) => value === cap)![1];
              const count = filterModels(models, '', cap).length;
              return (
                <button
                  key={cap}
                  type="button"
                  data-subtle
                  data-testid={`model-filter-${cap}`}
                  aria-pressed={capability === cap}
                  onClick={() => setCapability(cap)}
                  className="settings-model-filter-chip"
                >
                  {label}<span style={{ opacity: 0.7 }}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
        {models.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>{t('No models yet. Add one or sync from the endpoint.')}</span>
        )}
        {models.length > 0 && visible.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>{t('No models match.')}</span>
        )}
        {groups.map((group) => {
          const open = !collapsed.has(group.key);
          return (
            <section key={group.key} data-testid={`model-group-${group.key}`} className="settings-model-group">
              <button type="button" data-subtle aria-expanded={open} onClick={() => toggleGroup(group.key)}
                className="settings-model-group-header">
                <ChevronDown size={14} style={{
                  transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 0.12s var(--ease)',
                  color: 'var(--text-muted)',
                }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.label}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>{group.models.length}</span>
              </button>
              {open && group.models.map(model => (
                <ModelRow
                  key={model.id}
                  model={model}
                  active={model.id === activeId}
                  onRemove={() => requestRemove(model)}
                />
              ))}
            </section>
          );
        })}
      </Field>
      <AddModelDialog
        open={addOpen}
        row={row}
        toast={toast}
        onClose={() => setAddOpen(false)}
        onAdd={(model) => { void save(() => commitModels(current => [...current, model])); }}
      />
      <ConfirmDialog
        open={confirmRemove !== null}
        title={t('Delete model')}
        message={confirmRemove
          ? t('Remove {{name}} and its settings?', { name: confirmRemove.name || confirmRemove.model || t('Unnamed model') })
          : ''}
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
        danger
        onConfirm={removeConfirmed}
        onCancel={() => setConfirmRemove(null)}
      />
    </SettingsGroup>
  );
}

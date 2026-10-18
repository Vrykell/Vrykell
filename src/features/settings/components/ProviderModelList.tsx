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
import { IconButton } from '@ui/IconButton';
import { OutlineButton } from '@ui/OutlineButton';
import { TextInput } from '@ui/TextInput';
import ConfirmDialog from '@ui/ConfirmDialog';
import { ChevronDown, Eye, Filter, Globe, Lightbulb, Minus, Plus, RefreshCw, Search, Settings, Wrench, X, type AppIcon } from '@ui/icons';
import { detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { modelHue, modelMark } from '@features/agent/components/modelIcon';
import { providerFetchModels, useAiConfigStore, type ModelProfile } from '@features/agent';
import { commitModels, selectModel } from '@features/settings/model/modelWrites';
import { filterModels, groupModelsByVendor } from '@features/settings/model/modelGroups';
import type { ProviderRow } from '@features/settings/model/providerList';
import { SettingsGroup, Field } from './ui';
import AddModelDialog from './AddModelDialog';
import ModelSettingsDialog from './ModelSettingsDialog';
import { useSettingsSave } from './SettingsSaveProvider';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

/** The filter chips, in the order they appear. */
const FILTERS: (ModelCapability | 'all')[] = ['all', 'vision', 'reasoning', 'tools', 'search'];

/** Capability marks: metadata, so they stay quiet and answer the pointer instead of shouting. */
const CAPABILITIES: [ModelCapability, string, AppIcon][] = [
  ['vision', t('Vision'), Eye],
  ['reasoning', t('Reasoning'), Lightbulb],
  ['tools', t('Tools'), Wrench],
  ['search', t('Search'), Globe],
];

function CapabilityChips({ profile }: { profile: ModelProfile }) {
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);
  const present = CAPABILITIES.filter(([cap]) => caps[cap]);
  if (present.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0, color: 'var(--text-muted)' }}>
      {present.map(([cap, label, Icon]) => (
        <span
          key={cap}
          data-testid={`model-cap-${cap}`}
          data-tip={label}
          aria-label={label}
          className="model-cap-chip"
        >
          <Icon size={14} aria-hidden="true" />
        </span>
      ))}
    </div>
  );
}

function ModelRow({ model, active, onRemove, onSetCurrent, onIncomplete }: {
  model: ModelProfile;
  active: boolean;
  onRemove: () => void;
  onSetCurrent: () => void;
  onIncomplete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const Mark = modelMark(model.provider, model.model, model.baseUrl);
  const usable = model.model.trim().length > 0;
  return (
    <div data-testid="model-row" style={{ borderTop: '1px solid var(--border)', padding: '6px 10px' }}>
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
            fontWeight: active ? 'var(--fw-semibold)' : undefined,
          }}>
            {model.name || model.model || t('Unnamed model')}
          </span>
        </span>
        <CapabilityChips profile={model} />
        {active ? (
          <span
            data-testid="model-current"
            style={{ color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-font-scale))', flexShrink: 0 }}
          >
            {t('Current')}
          </span>
        ) : (
          <OutlineButton data-subtle onClick={() => (usable ? onSetCurrent() : onIncomplete())}>
            {t('Set as current')}
          </OutlineButton>
        )}
        <IconButton compact data-testid="model-settings" aria-expanded={editing}
          aria-label={t('Model settings')} data-tip={t('Model settings')} onClick={() => setEditing(true)}>
          <Settings size={14} />
        </IconButton>
        <IconButton compact tone="danger" data-testid="model-remove"
          aria-label={t('Delete model')} data-tip={t('Delete model')} onClick={onRemove}>
          <Minus size={14} />
        </IconButton>
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
        <div data-testid="model-list-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <IconButton compact data-testid="model-collapse-all" disabled={models.length === 0}
            aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')}
            data-tip={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={toggleAll}>
            <ChevronDown size={14} style={{ transform: allCollapsed ? undefined : 'rotate(180deg)', transition: 'transform 0.12s var(--ease)' }} />
          </IconButton>
          <IconButton compact data-testid="model-search-toggle" aria-expanded={searchOpen}
            aria-label={t('Search models')} data-tip={t('Search models')}
            onClick={() => { setSearchOpen(value => !value); if (searchOpen) setQuery(''); }}>
            <Search size={14} />
          </IconButton>
          <IconButton compact data-testid="model-filter-toggle" aria-expanded={filterOpen}
            aria-label={t('Filter models')} data-tip={t('Filter models')} onClick={() => setFilterOpen(value => !value)}>
            <Filter size={14} />
          </IconButton>
          <span style={{ flex: 1 }} />
          <OutlineButton data-testid="model-sync" disabled={syncing} onClick={() => void sync()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={12} /> {syncing ? t('Syncing…') : t('Sync models')}
          </OutlineButton>
          <IconButton compact data-testid="model-add" aria-label={t('Add model')} data-tip={t('Add model')} onClick={() => setAddOpen(true)}>
            <Plus size={14} />
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
                  onSetCurrent={() => { void save(() => selectModel(model.id)); }}
                  onIncomplete={() => toast(t('Fill in the model ID first.'), 'info')}
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

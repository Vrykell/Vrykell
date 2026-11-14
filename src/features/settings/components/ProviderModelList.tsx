/**
 * ProviderModelList — one provider's models: a searchable, vendor-grouped list with the sync
 * action that pulls the endpoint's own model list and a row menu for the low-frequency actions.
 *
 * The list closes its own loops: adding a model asks for its identifier before the row exists,
 * a model without one cannot be set as current, and deleting a row asks first because its
 * overrides cannot be recovered. The row itself stays quiet: name, identifier and capability
 * marks at rest, with edit, switch and delete behind one menu.
 */
import { useEffect, useMemo, useState } from 'react';
import { t } from '@i18n';
import { IconButton } from '@ui/actions/IconButton';
import ReloadButton from '@ui/actions/ReloadButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { TextInput } from '@ui/fields/TextInput';
import Select from '@ui/fields/Select';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { Check, ChevronDown, Ellipsis, Plus, Search, Settings, X, iconSizes } from '@ui/icons';
import { capabilityLabel, detectCapabilities, type ModelCapability } from '@features/agent/model/capabilities';
import { modelHue, modelMark } from '@features/agent/components/modelIcon';
import { ModelCapabilityBadge } from '@features/agent/components/ModelCapabilityBadge';
import { providerFetchModels, useAiConfigStore, type ModelProfile } from '@features/agent';
import { commitModels, selectModel } from '@features/settings/model/modelWrites';
import { filterModels, groupModelsByVendor } from '@features/settings/model/modelGroups';
import { readCollapsedModelGroups, saveCollapsedModelGroups } from '@features/settings/model/modelGroupCollapse';
import type { ProviderRow } from '@features/settings/model/providerList';
import { SettingsGroup, Field } from './ui';
import AddModelDialog from './AddModelDialog';
import ModelSettingsDialog from './ModelSettingsDialog';
import { useSettingsSave } from './SettingsSaveProvider';
import { useSettingsNavigationStore } from '../stores/navigation';
import { MODEL_CONTEXT_FIELDS } from './ModelContextSettings';

type Toast = (msg: string, type: 'info' | 'success' | 'error') => void;

/** The capability filter options, in the order they appear. */
const FILTERS: (ModelCapability | 'all')[] = ['all', 'vision', 'reasoning', 'tools', 'search'];

const CAPABILITIES: ModelCapability[] = ['vision', 'reasoning', 'tools', 'search'];

function CapabilityChips({ profile }: { profile: ModelProfile }) {
  const caps = profile.capabilities ?? detectCapabilities(profile.provider, profile.model);
  return (
    <span className="settings-model-capabilities">
      {CAPABILITIES.map((cap) => <ModelCapabilityBadge key={cap} capability={cap} supported={caps[cap]} />)}
    </span>
  );
}

function ModelRow({ model, active, onSetCurrent, onRemove }: {
  model: ModelProfile;
  active: boolean;
  onSetCurrent: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const target = useSettingsNavigationStore(state => state.targetField);
  const request = useSettingsNavigationStore(state => state.request);
  useEffect(() => {
    if (active && target && MODEL_CONTEXT_FIELDS.some(field => t(field) === target)) setEditing(true);
  }, [active, target, request]);
  const Mark = modelMark(model.provider, model.model, model.baseUrl);
  const name = model.name || model.model || t('Unnamed model');
  const identifier = model.model.trim();
  /** A synced row often names itself after its identifier; repeating it would print the same text twice. */
  const showIdentifier = !identifier || identifier.toLowerCase() !== name.trim().toLowerCase();
  return (
    <div className="settings-model-row" data-testid="model-row" data-active={active || undefined}
      aria-current={active ? 'true' : undefined}>
      <span className="settings-model-mark" style={{ color: modelHue(model.provider, model.model, model.baseUrl) }}>
        <Mark size={iconSizes.row} aria-hidden="true" />
      </span>
      <span className="settings-model-identity">
        <span className="settings-model-name-line">
          <span data-testid="model-name" className="settings-model-name">{name}</span>
          {active && (
            <span className="settings-model-current" data-testid="model-current">
              <Check size={12} aria-hidden="true" />
              {t('Current')}
            </span>
          )}
        </span>
        {showIdentifier && (
          <span className="settings-model-id" data-testid="model-id" data-tip={identifier || undefined}
            data-missing={identifier ? undefined : 'true'}>
            {identifier || t('No model ID')}
          </span>
        )}
      </span>
      <span className="settings-model-trailing">
        <CapabilityChips profile={model} />
        <span className="settings-row-actions">
          <IconButton data-testid="model-settings" aria-expanded={editing}
            aria-label={t('Model settings')} data-tip={t('Model settings')} onClick={() => setEditing(true)}>
            <Settings size={iconSizes.control} />
          </IconButton>
          <IconButton data-testid="model-actions" aria-haspopup="menu" aria-expanded={menu !== null}
            aria-label={t('Model actions')} data-tip={t('Model actions')}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left, y: rect.bottom + 4, trigger: event.currentTarget, align: 'end' });
            }}>
            <Ellipsis size={iconSizes.control} />
          </IconButton>
        </span>
      </span>
      {menu && (
        <ContextMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            ...(active ? [] : [{ label: t('Set as current'), onClick: onSetCurrent }]),
            { label: t('Edit model'), group: 'edit' as const, onClick: () => setEditing(true) },
            { label: t('Delete model'), danger: true, onClick: onRemove },
          ]}
        />
      )}
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
  const [capability, setCapability] = useState<ModelCapability | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedModelGroups);
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ModelProfile | null>(null);

  const models = row.models;
  const activeId = aiCfg.activeModel;
  const visible = useMemo(() => filterModels(models, query, capability), [models, query, capability]);
  const groups = useMemo(() => groupModelsByVendor(visible), [visible]);
  const allCollapsed = groups.length > 0 && groups.every(group => collapsed.has(group.key));

  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    saveCollapsedModelGroups(next);
  };
  const toggleAll = () => {
    const next = allCollapsed ? new Set<string>() : new Set(groups.map(group => group.key));
    setCollapsed(next);
    saveCollapsedModelGroups(next);
  };

  const setCurrent = (model: ModelProfile) => {
    if (!model.model.trim()) {
      toast(t('Fill in the model ID first.'), 'info');
      return;
    }
    void save(() => selectModel(model.id)).then(() => {
      toast(t('Switched to {{model}}', { model: model.name || model.model }), 'success');
    });
  };

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

  const filterOptions = FILTERS.map((cap) => ({
    value: cap,
    label: cap === 'all' ? t('All') : capabilityLabel(cap),
  }));

  return (
    <SettingsGroup title={t('Models')} testId="model-list">
      <Field
        layout="stacked"
        title={t('Model list')}
        description={t('Configure models and choose the active one. Models from the same provider share an API key.')}
      >
        <div className="settings-model-list">
          <div className="settings-model-toolbar" data-testid="model-list-toolbar">
            <div className="settings-model-search">
              <Search size={iconSizes.compact} aria-hidden="true" />
              <TextInput variant="field" type="search" value={query} data-testid="model-search"
                aria-label={t('Search models')} placeholder={t('Search by model name or ID…')}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
              {query && (
                <IconButton compact data-testid="model-search-clear" aria-label={t('Clear search')}
                  data-tip={t('Clear search')} onClick={() => setQuery('')}>
                  <X size={iconSizes.compact} />
                </IconButton>
              )}
            </div>
            <Select<ModelCapability | 'all'>
              aria-label={t('Filter models')}
              data-testid="model-filter"
              value={capability}
              options={filterOptions}
              onChange={setCapability}
              style={{ width: 132, flexShrink: 0 }}
            />
            <span className="settings-model-toolbar-actions">
              <IconButton data-testid="model-collapse-all" disabled={models.length === 0}
                aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')}
                data-tip={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={toggleAll}>
                <ChevronDown size={iconSizes.control} style={{ transform: allCollapsed ? undefined : 'rotate(180deg)', transition: 'transform 0.12s var(--ease)' }} />
              </IconButton>
              <ReloadButton testId="model-sync" busy={syncing} label={t('Sync models')} onReload={sync} />
              <OutlineButton className="primary-button" data-testid="model-add" onClick={() => setAddOpen(true)}>
                <Plus size={iconSizes.compact} aria-hidden="true" />{t('Add model')}
              </OutlineButton>
            </span>
          </div>
          {models.length === 0 && (
            <div className="search-empty-state" data-testid="model-empty">{t('No models yet. Add one or sync from the endpoint.')}</div>
          )}
          {models.length > 0 && visible.length === 0 && (
            <div className="search-empty-state" data-testid="model-no-match">
              {t('No models match.')}
              {query && <OutlineButton onClick={() => { setQuery(''); setCapability('all'); }}>{t('Clear search')}</OutlineButton>}
            </div>
          )}
          {groups.map((group) => {
            const open = !collapsed.has(group.key);
            return (
              <section key={group.key} data-testid={`model-group-${group.key}`} className="settings-model-group">
                <button type="button" data-subtle aria-expanded={open} onClick={() => toggleGroup(group.key)}
                  className="settings-model-group-header">
                  <ChevronDown size={14} aria-hidden="true" style={{
                    transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 0.12s var(--ease)',
                    color: 'var(--text-muted)',
                  }} />
                  <span className="settings-model-group-label">{group.label}</span>
                  <span className="settings-model-group-count">{group.models.length}</span>
                </button>
                {open && group.models.map(model => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    active={model.id === activeId}
                    onSetCurrent={() => setCurrent(model)}
                    onRemove={() => requestRemove(model)}
                  />
                ))}
              </section>
            );
          })}
        </div>
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
